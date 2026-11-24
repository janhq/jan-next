# Verify in the available environment

Use the authenticated Jan window or browser page the user already has connected. Do not open a separate browser from the shell, change `HOME`, inspect personal browser profiles, search for credentials, or alter keychains. If browser control is unavailable, check syntax, the manifest, and the live Client registration, and report that rendering was not verified. A screenshot of a mock page is not evidence that the plugin renders in Jan.

After `application: applied`, open the result at its real entry point and exercise it. Check the console for slot errors, compare a page or panel against a similar Jan view in light and dark themes, and confirm keyboard interaction where relevant. On Desktop, verify the intended surface in the Jan window, not only in a standalone Web session. If Jan reports `restart-required`, tell the user before restarting, then verify in the relaunched app. A browser reload does not restart the Host.

For any test subprocess or temporary resource, use a unique owned directory, bound execution, and await cleanup. A failed optional preview must not turn into environment repair or block installation.
