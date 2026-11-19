# L06: Account, sign-in, language

## Summary

The account footer menu, signing in and out with Tokamak, Language, Inference configuration, changelog and docs links.

Needs: the seed, a Tokamak test account, the network. Never use a real person's account. Port block 9460. Check for Keychain items created by sign-in and list them in the result file.

| ID | Via | Steps | Expect | Sev |
|---|---|---|---|---|
| L06-01 | any | Click the account footer. | Menu rows: Settings, Language, Inference configuration, View changelog, Learn more, Sign in with Tokamak. Each has an icon | P2 |
| L06-02 | any | Click "Sign in with Tokamak". | A browser or window opens at the sign-in page. The app says it is waiting. Cancelling in the browser returns to the app in a usable state | P1 |
| L06-03 | real | Complete sign-in with the test account. | The footer shows the account name, the menu now offers Sign out, and Tokamak models appear in the picker | P0 |
| L06-04 | real | Quit and relaunch. | Still signed in. No second sign-in prompt | P1 |
| L06-05 | real | Sign out from the menu. | The footer returns to Local, Tokamak models disappear, a chat using one opens and offers another model. No leftover token in the settings file | P1 |
| L06-06 | any | Start sign-in and close the browser tab without finishing. Wait 2 minutes. | The app does not spin forever; it either times out with a message or can be cancelled | P1 |
| L06-07 | any | Sign in with the network off. | A plain "no connection" message with Retry | P2 |
| L06-08 | any | Click Language. | A list of the supported languages with their own names. The current one is marked | P1 |
| L06-09 | any | Switch to Chinese, then Japanese, then back to English. | The whole window changes language at once with no restart. No English key leaks into the sidebar, menus, Settings or chat chrome | P1 |
| L06-10 | any | Switch language with a chat streaming. | The stream keeps running; only the chrome changes | P2 |
| L06-11 | any | Relaunch after changing language. | Language is kept | P1 |
| L06-12 | any | Click "Inference configuration". | It opens the model and inference settings page | P2 |
| L06-13 | any | Click "View changelog" and "Learn more". | Each opens the right page in the browser. No dead link | P2 |
| L06-14 | any | Use the footer menu with the keyboard only (Tab to the footer, Enter, arrows, Escape). | Fully usable; focus returns to the footer on close | P2 |
| L06-15 | any | Sign in on a profile that has the legacy import offer pending. | The sign-in does not break the offer. Both work in either order | P2 |
