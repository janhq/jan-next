# Model Hub

Open Models from the Jan sidebar to browse downloadable GGUF models. Search ranks model names, developers, and quant filenames, with support for partial words and common typos. Sort defaults to the most downloaded models; search relevance comes first when there is a query. The size sort uses the smallest quant plus the catalog's vision projector, if any. The date sort uses update dates when the catalog provides them and creation dates otherwise.

Tools, Vision, and Installed filters combine. When llama.cpp reports the host's hardware, Fits this computer limits the list to variants estimated to fit the available memory budget. The estimate uses catalog sizes and leaves headroom for the runtime; the actual requirement depends on context length and the model. Clear filters removes the search and all selected filters without changing the sort.

Download a quant from its card, pause to retain the partial file, or confirm cancellation to discard it. Use on an installed variant selects it for a new chat. The composer's model menu also offers Get local models, which closes the menu and opens the Hub. The plugin uses the existing `llamaCpp` Remote and declares no new slots, configuration, or services.
