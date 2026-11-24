---
name: dataset-health-audit
description: "Run a data quality check on tabular data (CSV/Excel/TSV/JSON) across 12 dimensions and output a quality score, issue details and fix suggestions. Use when the user asks for a data quality check, missing values, duplicate rows, outliers, format problems or mixed types, or mentions quality inspection, a pre-cleaning check, outlier detection, format validation, null values, data health or quality scores."
license: MIT
---

# data-quality-checker

A data quality inspection tool. It runs checks across 12 dimensions on tabular data and outputs a score (0-100) for each dimension, an overall score and concrete fix suggestions.

## Capabilities

| Dimension | Description |
|------|------|
| Missing values | Count and share of empty values / NaN per column |
| Duplicate rows | Count and share of fully duplicated rows |
| Data type consistency | Mixed types within one column (e.g. text in a numeric column) |
| Value range / outliers | Outliers detected with the IQR method |
| Format compliance | Format consistency of dates, emails, phone numbers and similar fields |
| Uniqueness constraints | Duplicates in ID-type fields |
| Blank strings | Leading/trailing spaces, empty strings, whitespace-only strings |
| Constant columns | Columns holding a single value (zero information) |
| Distribution skew | Whether the skewness of numeric columns is excessive |
| Column naming | Spaces, special characters or inconsistent letter case in column names |
| Cardinality anomalies | Unusually high or low number of unique values |
| Cross-column consistency | Cross-column logic such as date order and value comparisons |

## Quick Start

```bash
# Basic check
python3 scripts/data_quality_checker.py data.csv

# Save the report to JSON
python3 scripts/data_quality_checker.py data.csv --output report.json

# Specify ID columns (for the uniqueness check)
python3 scripts/data_quality_checker.py users.csv --id-columns "user_id,email"

# Specify date columns (for the format check)
python3 scripts/data_quality_checker.py orders.csv --date-columns "created_at,updated_at"
```

## Detailed usage

### Basic call

```bash
python3 scripts/data_quality_checker.py <data-file> [options]
```

### Arguments

| Argument | Short | Required | Default | Description |
|------|------|------|--------|------|
| `input` | - | Yes | - | Input file path (CSV/TSV/Excel/JSON) |
| `--output` | `-o` | No | stdout | Path for the JSON report |
| `--id-columns` | `-id` | No | auto-detect | Columns that should be unique, comma-separated |
| `--date-columns` | `-dc` | No | auto-detect | Date-type columns, comma-separated |
| `--sample` | `-s` | No | all rows | Number of rows to sample (for large files) |
| `--encoding` | `-e` | No | utf-8 | File encoding |

## Output structure (JSON)

```json
{
  "file": "data.csv",
  "rows": 10000,
  "columns": 15,
  "overall_score": 78.5,
  "grade": "B",
  "dimensions": {
    "missing_values": {
      "score": 85.0,
      "issues": [
        {"column": "age", "missing_count": 150, "missing_pct": 1.5, "suggestion": "Consider filling with the median or the mean"}
      ]
    },
    "duplicates": {
      "score": 95.0,
      "issues": [...]
    }
  },
  "top_suggestions": [
    "Column age has 1.5% missing values; consider filling with the median",
    "Found 200 fully duplicated rows; consider removing them"
  ]
}
```

## Grading

| Grade | Score range | Meaning |
|------|----------|------|
| A+ | 95-100 | Excellent quality, ready to use |
| A | 90-95 | Good quality, a few minor issues |
| B | 80-90 | Moderate quality, fix before use |
| C | 60-80 | Poor quality, needs focused cleaning |
| D | 40-60 | Very poor quality, many issues to fix |
| F | 0-40 | Essentially unusable, re-collect or clean extensively |

## Dependencies

- Python 3.8+
- pandas
- numpy

```bash
pip install pandas numpy
```
