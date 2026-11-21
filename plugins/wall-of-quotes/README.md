# Wall of Quotes

Jan Desktop shows a random quote and its author on each new chat. It draws from the enabled lists and skips the previous quote when another is available. If neither enabled list has a quote, Jan shows the conversation headline instead.

Open **Customize > Plugins > Built-in plugin settings > Wall of Quotes**. The switch at the top turns the feature on or off and keeps your lists intact. Under **Lists**, choose whether to include the built-in collection and your own quotes. Enter a quote and, optionally, its author, then select **Add**. Select **Remove** next to a quote to delete it.

The `jan-wall-of-quotes` profile entry stores `enabled`, `builtIn` and `custom`, all on by default, plus `quotes`, an initially empty list of `{ text, author }` entries. Settings apply as soon as Jan saves them.

## Model experience

This plugin adds no tools, prompt text or Session events. Quotes appear in the new-chat header only and are not sent to models.
