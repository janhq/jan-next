// Loaded only when the client needs the built-in list or the settings page opens.
window.__ModuleLoader__.load({
  id: '@janhq/jan-wall-of-quotes',
  chunk: 'client.quotes.js',
  factory() {
    // Sources: https://fi.edu/en/science-and-education/benjamin-franklin/famous-quotes
    // https://en.wikiquote.org/wiki/Walden
    // https://en.wikiquote.org/wiki/Henry_David_Thoreau
    // https://en.wikiquote.org/wiki/Essays_(Emerson)
    // https://en.wikiquote.org/wiki/Ralph_Waldo_Emerson
    // https://en.wikiquote.org/wiki/Seneca_the_Younger
    // https://en.wikiquote.org/wiki/George_Eliot
    // https://en.wikiquote.org/wiki/William_James
    // https://en.wikiquote.org/wiki/Marie_Curie
    // Short passages retain their authors' wording; some are excerpts of longer sentences.
    const builtInQuotes = [
      { text: 'Look before, or you’ll find yourself behind.', author: 'Benjamin Franklin' },
      { text: 'Well done is better than well said.', author: 'Benjamin Franklin' },
      { text: 'No gains without pains.', author: 'Benjamin Franklin' },
      { text: 'Lost Time is never found again.', author: 'Benjamin Franklin' },
      { text: 'Haste makes Waste.', author: 'Benjamin Franklin' },
      { text: 'What you seem to be, be really.', author: 'Benjamin Franklin' },
      { text: 'A right Heart exceeds all.', author: 'Benjamin Franklin' },
      { text: 'Wish not so much to live long as to live well.', author: 'Benjamin Franklin' },
      { text: 'Hide not your Talents, they for Use were made.', author: 'Benjamin Franklin' },
      { text: 'Search others for their virtues, thy self for thy vices.', author: 'Benjamin Franklin' },
      { text: 'It is never too late to give up our prejudices.', author: 'Henry David Thoreau' },
      { text: 'It is characteristic of wisdom not to do desperate things.', author: 'Henry David Thoreau' },
      { text: 'As if you could kill time without injuring eternity.', author: 'Henry David Thoreau' },
      { text: 'In the long run men hit only what they aim at.', author: 'Henry David Thoreau' },
      { text: 'I have learned that the swiftest traveller is he that goes afoot.', author: 'Henry David Thoreau' },
      { text: 'The man who goes alone can start today.', author: 'Henry David Thoreau' },
      { text: 'But lo! men have become the tools of their tools.', author: 'Henry David Thoreau' },
      { text: 'How could youths better learn to live than by at once trying the experiment of living?', author: 'Henry David Thoreau' },
      { text: 'A man is rich in proportion to the number of things which he can afford to let alone.', author: 'Henry David Thoreau' },
      { text: 'Morning is when I am awake and there is a dawn in me.', author: 'Henry David Thoreau' },
      { text: 'To be awake is to be alive.', author: 'Henry David Thoreau' },
      { text: 'To affect the quality of the day, that is the highest of arts.', author: 'Henry David Thoreau' },
      { text: 'Our life is frittered away by detail.', author: 'Henry David Thoreau' },
      { text: 'Simplify, simplify.', author: 'Henry David Thoreau' },
      { text: 'Let us spend one day as deliberately as Nature.', author: 'Henry David Thoreau' },
      { text: 'If the bell rings, why should we run?', author: 'Henry David Thoreau' },
      { text: 'Time is but the stream I go a-fishing in.', author: 'Henry David Thoreau' },
      { text: 'I love a broad margin to my life.', author: 'Henry David Thoreau' },
      { text: 'Read your fate, see what is before you, and walk on into futurity.', author: 'Henry David Thoreau' },
      { text: 'Grow wild according to thy nature, like these sedges and brakes.', author: 'Henry David Thoreau' },
      { text: 'No man ever followed his genius till it misled him.', author: 'Henry David Thoreau' },
      { text: 'Let us not underrate the value of a fact; it will one day flower in a truth.', author: 'Henry David Thoreau' },
      { text: 'It is not enough to be industrious; so are the ants. What are you industrious about?', author: 'Henry David Thoreau' },
      { text: 'Not that the story need be long, but it will take a long while to make it short.', author: 'Henry David Thoreau' },
      { text: 'An early morning walk is a blessing for the whole day.', author: 'Henry David Thoreau' },
      { text: 'Have no mean hours, but be grateful for every hour, and accept what it brings.', author: 'Henry David Thoreau' },
      { text: 'It is a great art to saunter.', author: 'Henry David Thoreau' },
      { text: 'How vain it is to sit down to write when you have not stood up to live.', author: 'Henry David Thoreau' },
      { text: 'The ancestor of every action is a thought.', author: 'Ralph Waldo Emerson' },
      { text: 'Trust thyself: every heart vibrates to that iron string.', author: 'Ralph Waldo Emerson' },
      { text: 'What I must do is all that concerns me, not what the people think.', author: 'Ralph Waldo Emerson' },
      { text: 'We but half express ourselves, and are ashamed of that divine idea which each of us represents.', author: 'Ralph Waldo Emerson' },
      { text: 'In every work of genius we recognize our own rejected thoughts.', author: 'Ralph Waldo Emerson' },
      { text: 'Your genuine action will explain itself, and will explain your other genuine actions.', author: 'Ralph Waldo Emerson' },
      { text: 'Be it how it will, do right now.', author: 'Ralph Waldo Emerson' },
      { text: 'The force of character is cumulative.', author: 'Ralph Waldo Emerson' },
      { text: 'Life only avails, not the having lived.', author: 'Ralph Waldo Emerson' },
      { text: 'Nothing can bring you peace but yourself.', author: 'Ralph Waldo Emerson' },
      { text: 'Our strength grows out of our weakness.', author: 'Ralph Waldo Emerson' },
      { text: 'A great man is always willing to be little.', author: 'Ralph Waldo Emerson' },
      { text: 'The world globes itself in a drop of dew.', author: 'Ralph Waldo Emerson' },
      { text: 'In skating over thin ice our safety is in our speed.', author: 'Ralph Waldo Emerson' },
      { text: 'Nothing great was ever achieved without enthusiasm.', author: 'Ralph Waldo Emerson' },
      { text: 'Nothing astonishes men so much as common sense and plain dealing.', author: 'Ralph Waldo Emerson' },
      { text: 'Only the great generalizations survive.', author: 'Ralph Waldo Emerson' },
      { text: 'I wish to write such rhymes as shall not suggest a restraint, but contrariwise the wildest freedom.', author: 'Ralph Waldo Emerson' },
      { text: 'What is a weed? A plant whose virtues have yet to be discovered.', author: 'Ralph Waldo Emerson' },
      { text: 'All life is an experiment. The more experiments you make the better.', author: 'Ralph Waldo Emerson' },
      { text: 'We are always getting ready to live, but never living.', author: 'Ralph Waldo Emerson' },
      { text: 'The blessed work of helping the world forward, happily does not wait to be done by perfect men.', author: 'George Eliot' },
      { text: 'The art of being wise is the art of knowing what to overlook.', author: 'William James' },
      { text: 'Poetry teaches the enormous force of a few words.', author: 'Ralph Waldo Emerson' },
      { text: 'The best ideas are common property.', author: 'Seneca' },
      { text: 'Lay hold of today’s task, and you will not need to depend so much upon tomorrow’s.', author: 'Seneca' },
      { text: 'While we are postponing, life speeds by.', author: 'Seneca' },
      { text: 'Who is everywhere is nowhere.', author: 'Seneca' },
      { text: 'For love of bustle is not industry.', author: 'Seneca' },
      { text: 'If you would not have a man flinch when the crisis comes, train him before it comes.', author: 'Seneca' },
      { text: 'Prove your words by your deeds.', author: 'Seneca' },
      { text: 'I do not know whether I shall make progress; but I should prefer to lack success rather than to lack faith.', author: 'Seneca' },
      { text: 'You need a change of soul rather than a change of climate.', author: 'Seneca' },
      { text: 'You must lay aside the burdens of the mind; until you do this, no place will satisfy you.', author: 'Seneca' },
      { text: 'No man ought to glory except in that which is his own.', author: 'Seneca' },
      { text: 'Be less curious about people and more curious about ideas.', author: 'Marie Curie' },
      { text: 'My thinking is first and last and always for the sake of my doing.', author: 'William James' },
      { text: 'What do we live for, if it is not to make life less difficult for each other?', author: 'George Eliot' },
      { text: 'He that owns himself has lost nothing.', author: 'Seneca' },
      { text: 'I hate quotation. Tell me what you know.', author: 'Ralph Waldo Emerson' },
      { text: 'No day will have been wholly misspent, if one sincere, thoughtful page has been written.', author: 'Henry David Thoreau' },
      { text: 'The most attractive sentences are not perhaps the wisest, but the surest and soundest.', author: 'Henry David Thoreau' },
    ]

    function pickQuote(preferences, stock, random = Math.random, previous) {
      const builtIn = preferences.builtIn ? stock : []
      const custom = preferences.custom ? preferences.quotes : []
      const total = builtIn.length + custom.length
      if (total === 0) return null
      const at = index => index < builtIn.length ? builtIn[index] : custom[index - builtIn.length]
      const sample = random()
      if (!previous || total === 1) return at(Math.floor(sample * total))

      const matchesPrevious = quote => quote.text === previous.text && quote.author === previous.author
      let available = 0
      for (let i = 0; i < total; i++) if (!matchesPrevious(at(i))) available++
      if (available === 0) return at(0)
      let index = Math.floor(sample * available)
      for (let i = 0; i < total; i++) {
        const quote = at(i)
        if (!matchesPrevious(quote) && index-- === 0) return quote
      }
    }

    return { builtInQuotes, pickQuote }
  },
})
