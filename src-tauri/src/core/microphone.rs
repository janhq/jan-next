//! WebView2 names loopback origins in its default prompt. Keep Jan's identity
//! visible without granting microphone access to untrusted embedded frames.

use std::cell::RefCell;

use tauri::{plugin::TauriPlugin, Manager, Runtime};
use webview2_com::{
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Deferral, ICoreWebView2PermissionRequestedEventArgs,
        ICoreWebView2PermissionRequestedEventArgs3, COREWEBVIEW2_PERMISSION_KIND,
        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        COREWEBVIEW2_PERMISSION_STATE_DENY,
    },
    PermissionRequestedEventHandler,
};
use windows::core::{Interface, PWSTR};

struct Pending {
    args: ICoreWebView2PermissionRequestedEventArgs,
    deferral: ICoreWebView2Deferral,
}

// COM objects stay on WebView2's UI thread, including while the dialog is open.
thread_local! {
    static PENDING: RefCell<Option<Pending>> = const { RefCell::new(None) };
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("microphone-consent")
        .on_webview_ready(|webview| {
            if webview.label() != crate::core::dsh::web::WINDOW_LABEL {
                return;
            }
            let handle = webview.app_handle().clone();
            let result = webview.with_webview(move |platform| unsafe {
                let install = || -> windows::core::Result<()> {
                    let core = platform.controller().CoreWebView2()?;
                    let mut token = 0;
                    core.add_PermissionRequested(
                        &PermissionRequestedEventHandler::create(Box::new(move |_, args| {
                            let Some(args) = args else { return Ok(()) };
                            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                            args.PermissionKind(&mut kind)?;
                            if kind != COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                                return Ok(());
                            }
                            args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
                            let mut raw_uri = PWSTR::null();
                            args.Uri(&mut raw_uri)?;
                            let uri = webview2_com::take_pwstr(raw_uri);
                            let trusted = tauri::Url::parse(&uri).ok().filter(|url| {
                                crate::core::dsh::web::is_host_url(&handle, url)
                            });
                            let Some(origin) = trusted else { return Ok(()) };
                            if PENDING.with(|pending| pending.borrow().is_some()) {
                                return Ok(());
                            }
                            // A new launch gets a new host origin. Do not leave hidden
                            // grants behind in the browser's persistent profile.
                            args.cast::<ICoreWebView2PermissionRequestedEventArgs3>()?
                                .SetSavesInProfile(false)?;
                            let deferral = args.GetDeferral()?;
                            PENDING.with(|pending| {
                                *pending.borrow_mut() = Some(Pending { args, deferral });
                            });
                            let Some(window) = handle.get_webview_window(crate::core::dsh::web::WINDOW_LABEL) else {
                                finish(false);
                                return Ok(());
                            };
                            let dialog = rfd::AsyncMessageDialog::new()
                                .set_parent(&window)
                                .set_title("Jan microphone access")
                                .set_description("Allow Jan to use your microphone?\n\nYou started a microphone test or voice recording. A test only shows the input level and does not save or send audio. Recordings use the speech recognition service selected in Voice input settings.\n\nAccess is allowed for this app session. You can stop the test or recording at any time.")
                                .set_buttons(rfd::MessageButtons::OkCancelCustom(
                                    "Allow microphone".into(), "Don't allow".into(),
                                ));
                            let app = handle.clone();
                            tauri::async_runtime::spawn(async move {
                                let allowed = dialog.show().await
                                    == rfd::MessageDialogResult::Custom("Allow microphone".into());
                                let check = app.clone();
                                if let Err(error) = app.run_on_main_thread(move || {
                                    let current = check.get_webview_window(crate::core::dsh::web::WINDOW_LABEL)
                                        .and_then(|window| window.url().ok());
                                    let still_trusted = current.as_ref().is_some_and(|url| {
                                        crate::core::dsh::web::is_host_url(&check, url)
                                            && url.origin() == origin.origin()
                                    });
                                    finish(allowed && still_trusted);
                                }) {
                                    log::warn!("Could not finish microphone consent: {error}");
                                }
                            });
                            Ok(())
                        })),
                        &mut token,
                    )?;
                    Ok(())
                };
                if let Err(error) = install() {
                    log::error!("Could not install Jan microphone consent: {error}");
                }
            });
            if let Err(error) = result {
                log::error!("Could not access microphone permission handler: {error}");
            }
        })
        .build()
}

fn finish(allowed: bool) {
    PENDING.with(|pending| {
        if let Some(pending) = pending.borrow_mut().take() {
            unsafe {
                let state = if allowed {
                    COREWEBVIEW2_PERMISSION_STATE_ALLOW
                } else {
                    COREWEBVIEW2_PERMISSION_STATE_DENY
                };
                if let Err(error) = pending.args.SetState(state) {
                    log::warn!("Could not set microphone permission: {error}");
                }
                if let Err(error) = pending.deferral.Complete() {
                    log::warn!("Could not complete microphone permission: {error}");
                }
            }
        }
    });
}
