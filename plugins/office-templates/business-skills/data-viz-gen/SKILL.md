---
name: data-viz-gen
description: "Generate self-contained HTML/SVG infographics from JSON data. Supports four types (KPI stat cards, grouped bar chart comparison, flow diagram and mixed dashboard), 8 color palettes and 24 built-in icons, and outputs a fully self-contained HTML file with no external dependencies. Use when the user needs data visualization, an infographic, a chart or a dashboard, or asks to generate charts, build a dashboard or present statistics."
license: MIT
type: tool
tags: ["infographic", "visualization", "svg", "html", "chart", "dashboard"]
---

# Infographic Builder

Generate self-contained HTML/SVG infographics from JSON data. Four types are supported:

1. **Stat cards (stats)** - large KPI numbers + trend arrows + icons
2. **Comparison (comparison)** - grouped bar chart with multiple series
3. **Flow diagram (flow)** - process steps with numbers, icons and arrow connectors
4. **Dashboard (dashboard)** - mixed layout: stat cards + bar chart + donut chart + flow

The output is a **fully self-contained** HTML file (all CSS/SVG inline, no external dependencies) that opens directly in a browser.

## Usage

### Basic usage

```bash
python3 scripts/build_infographic.py config.json
```

stdin is also supported:

```bash
cat config.json | python3 scripts/build_infographic.py
```

The script prints a JSON status to stdout and writes the generated HTML to the path given in the `output` field.

### JSON configuration

Common fields:

| Field | Type | Required | Description |
|------|------|------|------|
| `title` | string | No | Infographic title |
| `subtitle` | string | No | Subtitle |
| `type` | string | Yes | `stats` / `comparison` / `flow` / `dashboard` |
| `palette` | string | No | Color palette (default `auto`) |
| `data` | object/array | Yes | Content (format depends on type) |
| `output` | string | No | Output file path (default `infographic.html`) |
| `footer` | string | No | Footer text |

### Palettes

Allowed values: `auto` (chosen from the data), `ocean`, `sunset`, `forest`, `berry`, `vibrant`, `corporate`, `pastel`, `earth`

### The data format for each type

#### 1. stats - stat cards

```json
{
  "type": "stats",
  "data": [
    {
      "label": "Total revenue",
      "value": "$1.2M",
      "icon": "money",
      "trend": "+12.5%",
      "trend_dir": "up"
    },
    {
      "label": "Users",
      "value": "45,230",
      "icon": "users",
      "trend": "+8.2%",
      "trend_dir": "up"
    }
  ]
}
```

**icon** values: `users`, `user`, `money`, `percent`, `globe`, `clock`, `check`, `star`, `target`, `zap`, `chart-bar`, `chart-pie`, `database`, `rocket`, `shield`, `heart`, `light`, `search`, `mail`, `settings`, `flag`, `trending-up`, `trending-down`

**trend_dir**: `up` (green up arrow) or `down` (red down arrow)

#### 2. comparison - grouped bar chart

```json
{
  "type": "comparison",
  "data": {
    "chart_title": "Quarterly revenue comparison",
    "categories": ["Q1", "Q2", "Q3", "Q4"],
    "series": [
      {"name": "2024", "values": [320, 410, 380, 520]},
      {"name": "2025", "values": [380, 490, 450, 610]}
    ]
  }
}
```

#### 3. flow - flow diagram

```json
{
  "type": "flow",
  "data": [
    {"step": 1, "title": "Requirements", "description": "Collect user needs", "icon": "search"},
    {"step": 2, "title": "Design", "description": "Define the technical approach", "icon": "light"},
    {"step": 3, "title": "Development", "description": "Coding and testing", "icon": "settings"},
    {"step": 4, "title": "Release", "description": "Deploy to production", "icon": "rocket"}
  ]
}
```

#### 4. dashboard - mixed dashboard

```json
{
  "type": "dashboard",
  "data": {
    "stats": [
      {"label": "DAU", "value": "12.3K", "icon": "users", "trend": "+5%", "trend_dir": "up"},
      {"label": "Conversion rate", "value": "3.8%", "icon": "target", "trend": "-0.2%", "trend_dir": "down"}
    ],
    "chart": {
      "chart_title": "Monthly trend",
      "categories": ["Jan", "Feb", "Mar", "Apr"],
      "series": [{"name": "DAU", "values": [10200, 11500, 11800, 12300]}]
    },
    "breakdown": [
      {"label": "iOS", "value": 45},
      {"label": "Android", "value": 38},
      {"label": "Web", "value": 17}
    ],
    "flow": [
      {"step": 1, "title": "Sign-up", "description": ""},
      {"step": 2, "title": "Activation", "description": ""},
      {"step": 3, "title": "Retention", "description": ""}
    ]
  }
}
```

## Output format

The script prints a JSON result to stdout:

```json
{
  "status": "success",
  "output": "/absolute/path/to/infographic.html",
  "type": "stats",
  "title": "My Infographic",
  "palette": "auto",
  "size_bytes": 8432
}
```

On error:

```json
{
  "status": "error",
  "errors": ["Missing required field: data"]
}
```

## Design features

- **Zero external dependencies**: pure Python standard library, no pip install
- **Self-contained output**: HTML with all CSS and SVG inline, no network needed
- **Responsive layout**: works on desktop and mobile browsers
- **Professional palettes**: 8 preset palettes + automatic selection
- **24+ built-in icons**: common SVG icons, no font files
- **CJK-friendly**: the font stack includes Source Han Sans, PingFang and Microsoft YaHei

## Use cases

- Visualization blocks in data reports
- Product data dashboards
- Business process explanations
- Quarterly / monthly data comparisons
- Team KPI displays

## Dependencies

- Python 3.7+ (standard library only)
