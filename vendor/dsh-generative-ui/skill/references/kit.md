# The `$dsh/ui` component kit

`import { … } from "$dsh/ui"` gives you ready components that already follow the app's fonts and
colours in light and dark. Use them for the patterns they cover instead of hand-styling `div`s;
use utility classes for whatever layout they do not cover. Every name below is an export; there
are no others, and a prop not listed here does nothing.

## Conventions

- **Spacing counts 4 px steps.** `gap={2}` is 8 px, `gap={4}` is 16 px. Three tiers that nest:
  inner `1`-`2` (a title with its subtitle, a row of badges), group `3`-`4` (blocks inside a card
  or grid cell), section `6` (between the blocks of the answer).
- **Colours are tokens or CSS colours.** Text and icons: `"ink"`, `"muted"`, `"faint"`,
  `"info"`, `"success"`, `"warning"`, `"danger"`, `"purple"`, `"pink"`, `"chart1"`-`"chart6"`.
  As a background, a status token becomes its soft tint. Prefer tokens: they follow the theme.
- **Icons are Lucide names** in kebab case: `"map-pin"`, `"check-circle"`, `"arrow-right"`.
- **Controls report values, not events.** `onChange` receives the new value. Bind them to
  `usePersistedState` from `$dsh/state` like any other card-owned value.
- **Radius** is `"sm"`, `"md"`, `"lg"`, `"xl"`, `"full"` or px.

## Components

| Component | Props |
| --- | --- |
| `Col`, `Row` | `gap?`, `align?: "start" \| "center" \| "end" \| "stretch"`, `justify?: "start" \| "center" \| "end" \| "between"`, `wrap?`, children |
| `Box` | `direction?: "row" \| "col"`, `gap?`, `padding?`, `background?`, `radius?`, `border?`, `width?`, `height?`, `flex?`, `align?`, `justify?`, `wrap?`, children |
| `Card` | `variant?: "outline" \| "soft"`, `padding?`, `gap?`, children |
| `Grid` | `columns?` (1-12, default 2), `gap?`, `minChildWidth?` (px; columns drop on narrow screens so none is narrower), children |
| `Spacer` | none: pushes what follows it in a `Row` to the far end |
| `Title` | `size?: "sm" \| "md" \| "lg" \| "xl" \| "2xl" \| "3xl"`, `color?`, children |
| `Text` | `size?: "xs" \| "sm" \| "md" \| "lg"`, `color?`, `weight?: "normal" \| "medium" \| "semibold"`, `italic?`, `lineThrough?`, `tabularNums?`, `maxLines?`, children |
| `Caption` | `color?`, children: a small muted label |
| `Markdown` | `text`: headings, lists, quotes, code, rules and tables |
| `Badge` | `text`, `color?: "neutral" \| "info" \| "success" \| "warning" \| "danger" \| "purple" \| "pink"`, `icon?` |
| `Icon` | `name`, `size?: "sm" \| "md" \| "lg" \| "xl"`, `color?` |
| `Button` | `variant?: "solid" \| "outline" \| "soft" \| "ghost"`, `size?: "sm" \| "md" \| "lg"`, `color?: "primary" \| "danger" \| "success"`, `icon?`, `block?`, `disabled?`, `onClick`, children |
| `IconButton` | `icon`, `variant?: "outline" \| "ghost" \| "solid"`, `aria-label`, `onClick` |
| `Link` | `url`, children: opens outside the app |
| `List` | `items: ReactNode[]`, `marker?: "bullet" \| "number" \| "none"`, `timeline?` |
| `ListItem` | `title`, `description?`, `marker?`, children |
| `Quote` | `cite?`, children |
| `Form` | children: stacks fields at the form rhythm |
| `Field` | `label?`, `required?`, `error?`, children: wraps your own input |
| `Checkbox` | `label`, `checked`, `onChange(checked)`, `lineThrough?`, `required?`, `error?` |
| `RadioGroup` | `options: { value, label, description? }[]`, `value` (`""` for none), `onChange(value)`, `variant?: "list" \| "cards" \| "pills"`, `label?`, `required?`, `error?` |
| `SegmentedControl` | `options: { value, label }[]`, `value`, `onChange(value)`, `block?` |
| `Slider` | `value`, `onChange(value)`, `min`, `max`, `step?`, `label?`, `unit?`, `marks?: { value, label }[]` |
| `Pressable` | `onPress?`, `selected?`, `disabled?`, `padding?`, `background?`, `radius?`, children: any block as one big button |
| `Popover` | `trigger`, children: an aside that opens on click |
| `Carousel` | `items: ReactNode[]`, `itemWidth?`, `gap?`: a scrolling strip with arrows |
| `Flashcard` | `front`, `back`, `hint?`: flips on click |
| `Timer` | `seconds`, `onSecondsChange(seconds)`, `label?`, `disabled?`: a countdown you own |
| `Celebration` | `when`, `paused?`: confetti the moment `when` turns true |
| `Code` | `code`, `language?`: with a copy button |
| `MathBlock` | `tex`, `inline?`: KaTeX |
| `Photo` | `alt`, `src?`, `aspectRatio?`, `radius?`, `fit?: "cover" \| "contain"` |
| `Svg` | `viewBox`, `label?`, `width?`, `height?`, children: plain SVG shapes inside |
| `HtmlView` | `html`, `height?`, `title?`: a sandboxed page, only for a game or animation that needs its own loop |
| `YouTube` | `video` (URL or id), `title?` |

`ThemeProvider` exists for completeness; a card does not need it, and wrapping one in it detaches
the card from the app's theme.

## House style

- **Compose like a page, not a form letter.** A `Title`, one short `Text`, then blocks that show
  the content: `Row`, `Grid` and `Carousel` to set things side by side, a row of `Badge`s for
  quick facts, `Card` only to group a block, `Popover` for an aside.
- **Keep cards compact.** `Title size="md"` for a card heading (`xl` or larger only for one big
  number), `Text size="sm"` for the body, at most one short paragraph, then facts as `Badge`s or
  label/value rows (`Caption`, `Spacer`, `Text`). Cards side by side share the same blocks in the
  same order, so they line up.
- **Facts are badges, never buttons.** A `Button` is something the reader can do.
- **`Photo` only with a URL the user or a tool gave you in this conversation.** Never write an
  image URL yourself: it will often be wrong. Without one, show the subject with an `Icon`,
  `Badge`s or an `Svg` drawing.
- **Draw with `Svg` when the reader would otherwise have to picture it:** assembly steps, how a
  mechanism works, a room layout. Keep each drawing to a viewBox about 240 wide and a dozen
  shapes, with `fill="currentColor"` or theme variables rather than fixed colours.
- **Pick the medium that shows the idea:** `Flashcard` and `Celebration` for learning and games,
  `SegmentedControl` to switch between cases, `Slider` for a number to explore.

## Worked cards

### A trip, composed

```tsx
import { Badge, Card, Col, Icon, Row, Text, Title } from "$dsh/ui";

const PLAN = [
  { day: 1, title: "Alfama", place: "São Jorge Castle", text: "Climb to the castle, then lunch on grilled sardines." },
  { day: 2, title: "Belém", place: "Jerónimos Monastery", text: "The monastery, the tower and pastéis de Belém." },
  { day: 3, title: "Sintra", place: "Pena Palace", text: "Train from Rossio; book the palace for 9 AM." },
];

export default function Trip() {
  return (
    <Col gap={6}>
      <Col gap={2}>
        <Title size="xl">Three days in Lisbon</Title>
        <Text>Hills, tiled facades and the Tagus: start in Alfama, give a day to Belém, then take the train to Sintra.</Text>
        <Row gap={2} wrap>
          <Badge text="Best in April to June" />
          <Badge text="Tram 28" color="info" icon="tram-front" />
          <Badge text="About €120 a day" color="success" />
        </Row>
      </Col>
      <Col gap={3}>
        {PLAN.map((d) => (
          <Card key={d.day} variant="soft" gap={2}>
            <Row gap={2} align="center">
              <Badge text={`Day ${d.day}`} color="info" />
              <Text weight="semibold">{d.title}</Text>
            </Row>
            <Row gap={1} align="center">
              <Icon name="map-pin" size="sm" color="muted" />
              <Text size="sm">{d.place}</Text>
            </Row>
            <Text size="sm" color="muted">{d.text}</Text>
          </Card>
        ))}
      </Col>
    </Col>
  );
}
```

### A stepper that rescales a checklist

```tsx
import { Button, Card, Checkbox, Col, IconButton, Row, Text, Title } from "$dsh/ui";
import { usePersistedState } from "$dsh/state";

const BASE = [
  { name: "spaghetti", qty: 400, unit: " g" },
  { name: "tomatoes", qty: 6, unit: "" },
  { name: "parmesan", qty: 80, unit: " g" },
];

export default function Shopping() {
  const [guests, setGuests] = usePersistedState("pasta-guests", 4);
  const [got, setGot] = usePersistedState<string[]>("pasta-got", []);
  const toggle = (name: string) => setGot(got.includes(name) ? got.filter((n) => n !== name) : [...got, name]);
  return (
    <Card gap={4}>
      <Title size="md">Pasta night for {guests} {guests === 1 ? "guest" : "guests"}</Title>
      <Row gap={3} align="center">
        <IconButton icon="minus" aria-label="Fewer guests" disabled={guests <= 1} onClick={() => setGuests(Math.max(1, guests - 1))} />
        <Text size="lg" weight="semibold" tabularNums>{guests}</Text>
        <IconButton icon="plus" aria-label="More guests" disabled={guests >= 20} onClick={() => setGuests(Math.min(20, guests + 1))} />
      </Row>
      <Col gap={1}>
        {BASE.map((i) => (
          <Checkbox
            key={i.name}
            label={`${Math.round((i.qty * guests) / 4)}${i.unit} ${i.name}`}
            checked={got.includes(i.name)}
            onChange={() => toggle(i.name)}
            lineThrough
          />
        ))}
      </Col>
      <Row>
        <Button variant="outline" size="sm" icon="rotate-ccw" disabled={got.length === 0} onClick={() => setGot([])}>
          Clear ticks
        </Button>
      </Row>
    </Card>
  );
}
```

### A choice that becomes the reply

Selecting is a persisted draft; one Submit sends it, once.

```tsx
import { Button, Card, Col, RadioGroup, Text, Title } from "$dsh/ui";
import { sendMessage } from "$dsh/chat";
import { usePersistedState } from "$dsh/state";

const OPTIONS = [
  { value: "relaxed", label: "Relaxed", description: "Two sights a day, long lunches" },
  { value: "packed", label: "Packed", description: "Everything, with early starts" },
];

export default function Pace() {
  const [pace, setPace] = usePersistedState("lisbon-pace-draft", "");
  const [sent, setSent] = usePersistedState<string | null>("lisbon-pace-sent", null);
  const submit = () => {
    if (sent !== null || pace === "") return;
    setSent(pace);
    sendMessage(`Plan my Lisbon trip at a ${pace} pace`);
  };
  return (
    <Card gap={4}>
      <Col gap={1}>
        <Title size="md">How full should the days be?</Title>
        <Text size="sm" color="muted">{sent ? `Sent: ${sent}` : "Pick one, then send it."}</Text>
      </Col>
      <RadioGroup variant="cards" options={OPTIONS} value={pace} onChange={setPace} />
      <Button disabled={pace === "" || sent !== null} onClick={submit} icon="send">Plan my trip</Button>
    </Card>
  );
}
```

### A number to explore, with a live result

```tsx
import { Card, Col, Row, SegmentedControl, Slider, Spacer, Text, Title } from "$dsh/ui";
import { usePersistedState } from "$dsh/state";

const RATES = { "15": 0.062, "30": 0.068 } as const;

export default function Mortgage() {
  const [price, setPrice] = usePersistedState("mortgage-price", 400000);
  const [term, setTerm] = usePersistedState<"15" | "30">("mortgage-term", "30");
  const r = RATES[term] / 12;
  const n = Number(term) * 12;
  const loan = price * 0.8;
  const monthly = (loan * r) / (1 - Math.pow(1 + r, -n));
  const money = (v: number) => v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return (
    <Card gap={4}>
      <Title size="md">Monthly payment</Title>
      <Slider label="Home price" value={price} onChange={setPrice} min={100000} max={1500000} step={10000} unit="$" />
      <SegmentedControl options={[{ value: "15", label: "15 years" }, { value: "30", label: "30 years" }]} value={term} onChange={(v) => setTerm(v as "15" | "30")} />
      <Col gap={1}>
        <Row><Text size="sm" color="muted">Loan (20% down)</Text><Spacer /><Text size="sm" tabularNums>{money(loan)}</Text></Row>
        <Row><Text size="sm" color="muted">Rate</Text><Spacer /><Text size="sm" tabularNums>{(RATES[term] * 100).toFixed(1)}%</Text></Row>
      </Col>
      <Title size="2xl">{money(monthly)}</Title>
    </Card>
  );
}
```
