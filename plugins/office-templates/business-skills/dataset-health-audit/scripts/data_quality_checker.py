#!/usr/bin/env python3
"""
data_quality_checker.py - Data quality checker
Runs checks across 12 dimensions and outputs quality scores plus fix suggestions.
"""

import argparse
import json
import os
import re
import sys
from collections import Counter

import numpy as np
import pandas as pd


DIMENSION_WEIGHTS = {
    "missing_values": 15,
    "duplicates": 10,
    "type_consistency": 10,
    "value_range": 10,
    "format_compliance": 10,
    "uniqueness": 8,
    "whitespace": 7,
    "constant_columns": 5,
    "distribution_skew": 5,
    "column_naming": 5,
    "cardinality": 5,
    "cross_column": 10,
}

EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")
PHONE_RE = re.compile(r"^(\+?\d{1,4}[\s\-]?)?\(?\d{2,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{4}$")
URL_RE = re.compile(r"^https?://[^\s]+$")
DATE_FORMATS = [
    "%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y", "%d/%m/%Y",
    "%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S",
    "%Y%m%d", "%m/%d/%Y", "%m-%d-%Y",
]


def load_data(path: str, encoding: str = "utf-8", sample: int = None) -> pd.DataFrame:
    ext = os.path.splitext(path)[1].lower()
    kwargs = {}
    if ext == ".csv":
        df = pd.read_csv(path, encoding=encoding)
    elif ext in (".xls", ".xlsx"):
        df = pd.read_excel(path)
    elif ext == ".tsv":
        df = pd.read_csv(path, sep="\t", encoding=encoding)
    elif ext == ".json":
        df = pd.read_json(path, encoding=encoding)
    else:
        df = pd.read_csv(path, encoding=encoding)

    if sample and sample < len(df):
        df = df.sample(n=sample, random_state=42).reset_index(drop=True)
    return df


def score_to_grade(score: float) -> str:
    if score >= 95:
        return "A+"
    elif score >= 90:
        return "A"
    elif score >= 80:
        return "B"
    elif score >= 60:
        return "C"
    elif score >= 40:
        return "D"
    return "F"


# --- Dimension 1: Missing values ---

def check_missing_values(df: pd.DataFrame) -> dict:
    issues = []
    total_cells = len(df) * len(df.columns)
    total_missing = 0

    for col in df.columns:
        missing = int(df[col].isna().sum())
        if missing > 0:
            pct = round(missing / len(df) * 100, 2)
            total_missing += missing
            if pd.api.types.is_numeric_dtype(df[col]):
                suggestion = f"Consider filling with the median ({df[col].median():.4g}) or the mean"
            else:
                mode_vals = df[col].mode()
                if len(mode_vals) > 0:
                    suggestion = f"Consider filling with the mode '{mode_vals.iloc[0]}', or flag it with a dedicated missing-value marker"
                else:
                    suggestion = "Consider dropping this column or adding a data source"
            issues.append({
                "column": col,
                "missing_count": missing,
                "missing_pct": pct,
                "suggestion": suggestion,
            })

    if total_cells == 0:
        score = 100.0
    else:
        score = round(100 * (1 - total_missing / total_cells), 2)

    return {"score": max(score, 0), "issues": issues}


# --- Dimension 2: Duplicate rows ---

def check_duplicates(df: pd.DataFrame) -> dict:
    dup_mask = df.duplicated(keep="first")
    dup_count = int(dup_mask.sum())
    issues = []

    if dup_count > 0:
        pct = round(dup_count / len(df) * 100, 2)
        sample_indices = list(df[dup_mask].index[:5])
        issues.append({
            "duplicate_rows": dup_count,
            "duplicate_pct": pct,
            "sample_row_indices": sample_indices,
            "suggestion": f"Found {dup_count} fully duplicated rows ({pct}%); consider removing them with drop_duplicates()",
        })

    score = round(100 * (1 - dup_count / max(len(df), 1)), 2)
    return {"score": max(score, 0), "issues": issues}


# --- Dimension 3: Data type consistency ---

def _is_string_col(series: pd.Series) -> bool:
    return pd.api.types.is_string_dtype(series) or series.dtype == object


def check_type_consistency(df: pd.DataFrame) -> dict:
    issues = []
    problem_cols = 0

    for col in df.columns:
        non_null = df[col].dropna()
        if len(non_null) == 0:
            continue

        if _is_string_col(df[col]):
            type_counts = Counter(type(v).__name__ for v in non_null)
            if len(type_counts) > 1:
                problem_cols += 1
                dominant = type_counts.most_common(1)[0]
                issues.append({
                    "column": col,
                    "types_found": dict(type_counts),
                    "suggestion": f"Column mixes several types, mostly {dominant[0]} ({dominant[1]} values); consider converting to one type",
                })
            elif "str" in type_counts:
                numeric_count = 0
                for v in non_null:
                    try:
                        float(v)
                        numeric_count += 1
                    except (ValueError, TypeError):
                        pass
                if 0 < numeric_count < len(non_null) and numeric_count > len(non_null) * 0.5:
                    problem_cols += 1
                    non_numeric = len(non_null) - numeric_count
                    issues.append({
                        "column": col,
                        "numeric_values": numeric_count,
                        "non_numeric_values": non_numeric,
                        "suggestion": f"{non_numeric} values cannot be converted to numbers while the rest are numeric; clean them and convert the column to a numeric type",
                    })

    total = len(df.columns)
    score = round(100 * (1 - problem_cols / max(total, 1)), 2)
    return {"score": max(score, 0), "issues": issues}


# --- Dimension 4: Value range / outliers ---

def check_value_range(df: pd.DataFrame) -> dict:
    issues = []
    num_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    outlier_cols = 0

    for col in num_cols:
        series = df[col].dropna()
        if len(series) < 4:
            continue
        q1 = series.quantile(0.25)
        q3 = series.quantile(0.75)
        iqr = q3 - q1
        lower = q1 - 1.5 * iqr
        upper = q3 + 1.5 * iqr
        outliers = series[(series < lower) | (series > upper)]
        if len(outliers) > 0:
            pct = round(len(outliers) / len(series) * 100, 2)
            if pct > 1:
                outlier_cols += 1
            issues.append({
                "column": col,
                "outlier_count": int(len(outliers)),
                "outlier_pct": pct,
                "range": {"min": float(series.min()), "max": float(series.max())},
                "iqr_bounds": {"lower": round(float(lower), 4), "upper": round(float(upper), 4)},
                "suggestion": f"{len(outliers)} values fall outside the IQR range [{lower:.4g}, {upper:.4g}]; check for entry errors or consider capping",
            })

    total = max(len(num_cols), 1)
    score = round(100 * (1 - outlier_cols / total), 2)
    return {"score": max(score, 0), "issues": issues}


# --- Dimension 5: Format compliance ---

def _detect_format(series: pd.Series) -> str | None:
    sample = series.dropna().astype(str).head(100)
    if len(sample) == 0:
        return None

    email_match = sum(1 for v in sample if EMAIL_RE.match(v.strip()))
    if email_match > len(sample) * 0.5:
        return "email"

    phone_match = sum(1 for v in sample if PHONE_RE.match(v.strip()))
    if phone_match > len(sample) * 0.5:
        return "phone"

    url_match = sum(1 for v in sample if URL_RE.match(v.strip()))
    if url_match > len(sample) * 0.5:
        return "url"

    for fmt in DATE_FORMATS:
        date_match = 0
        for v in sample:
            try:
                pd.to_datetime(v.strip(), format=fmt)
                date_match += 1
            except (ValueError, TypeError):
                pass
        if date_match > len(sample) * 0.7:
            return f"date:{fmt}"

    return None


def check_format_compliance(df: pd.DataFrame) -> dict:
    issues = []
    checked = 0
    problem_cols = 0

    for col in df.columns:
        if _is_string_col(df[col]):
            detected = _detect_format(df[col])
            if detected is None:
                continue
            checked += 1
            non_null = df[col].dropna().astype(str)

            if detected == "email":
                bad = [v for v in non_null if not EMAIL_RE.match(v.strip())]
            elif detected == "phone":
                bad = [v for v in non_null if not PHONE_RE.match(v.strip())]
            elif detected == "url":
                bad = [v for v in non_null if not URL_RE.match(v.strip())]
            elif detected.startswith("date:"):
                fmt = detected.split(":", 1)[1]
                bad = []
                for v in non_null:
                    try:
                        pd.to_datetime(v.strip(), format=fmt)
                    except (ValueError, TypeError):
                        bad.append(v)
            else:
                bad = []

            if bad:
                pct = round(len(bad) / len(non_null) * 100, 2)
                problem_cols += 1
                issues.append({
                    "column": col,
                    "detected_format": detected,
                    "invalid_count": len(bad),
                    "invalid_pct": pct,
                    "samples": bad[:5],
                    "suggestion": f"Detected {detected} format, but {len(bad)} values do not match ({pct}%); consider standardizing the format",
                })

    if checked == 0:
        score = 100.0
    else:
        score = round(100 * (1 - problem_cols / checked), 2)
    return {"score": max(score, 0), "issues": issues}


# --- Dimension 6: Uniqueness constraints ---

def check_uniqueness(df: pd.DataFrame, id_columns: list[str] = None) -> dict:
    issues = []

    if not id_columns:
        id_columns = []
        for col in df.columns:
            col_lower = col.lower().strip()
            if col_lower in ("id", "uuid", "key"):
                id_columns.append(col)
            elif col_lower.endswith("_id") or col_lower.startswith("id_"):
                id_columns.append(col)
            elif any(kw in col_lower for kw in ["uuid", "guid", "serial"]):
                id_columns.append(col)

    if not id_columns:
        return {"score": 100.0, "issues": [], "note": "No ID-like columns detected; uniqueness check skipped"}

    problem_cols = 0
    for col in id_columns:
        if col not in df.columns:
            continue
        non_null = df[col].dropna()
        dup_count = int(non_null.duplicated().sum())
        if dup_count > 0:
            problem_cols += 1
            pct = round(dup_count / len(non_null) * 100, 2)
            dup_vals = non_null[non_null.duplicated(keep=False)].value_counts().head(5)
            issues.append({
                "column": col,
                "duplicate_count": dup_count,
                "duplicate_pct": pct,
                "top_duplicates": {str(k): int(v) for k, v in dup_vals.items()},
                "suggestion": f"ID column '{col}' has {dup_count} duplicate values ({pct}%); check the data source or add a primary key constraint",
            })

    score = round(100 * (1 - problem_cols / max(len(id_columns), 1)), 2)
    return {"score": max(score, 0), "issues": issues}


# --- Dimension 7: Blank strings ---

def check_whitespace(df: pd.DataFrame) -> dict:
    issues = []
    str_cols = df.select_dtypes(include=["object", "string"]).columns.tolist()
    problem_cols = 0

    for col in str_cols:
        non_null = df[col].dropna()
        if len(non_null) == 0:
            continue

        str_vals = non_null.astype(str)
        leading_trailing = int((str_vals != str_vals.str.strip()).sum())
        empty_strings = int((str_vals.str.strip() == "").sum())
        whitespace_only = int(str_vals.str.match(r"^\s+$").sum())

        total_issues = leading_trailing + empty_strings
        if total_issues > 0:
            problem_cols += 1
            detail = []
            if leading_trailing > 0:
                detail.append(f"{leading_trailing} values have leading or trailing spaces")
            if empty_strings > 0:
                detail.append(f"{empty_strings} empty strings")
            if whitespace_only > 0:
                detail.append(f"{whitespace_only} values contain only whitespace")

            issues.append({
                "column": col,
                "leading_trailing_spaces": leading_trailing,
                "empty_strings": empty_strings,
                "whitespace_only": whitespace_only,
                "suggestion": f"Column '{col}': {'; '.join(detail)}; consider strip() cleaning and converting empty strings to NaN",
            })

    total = max(len(str_cols), 1)
    score = round(100 * (1 - problem_cols / total), 2)
    return {"score": max(score, 0), "issues": issues}


# --- Dimension 8: Constant columns ---

def check_constant_columns(df: pd.DataFrame) -> dict:
    issues = []
    constant_cols = 0

    for col in df.columns:
        nunique = df[col].dropna().nunique()
        if nunique <= 1:
            constant_cols += 1
            val = df[col].dropna().iloc[0] if nunique == 1 and len(df[col].dropna()) > 0 else "N/A"
            issues.append({
                "column": col,
                "unique_values": nunique,
                "constant_value": str(val),
                "suggestion": f"Column '{col}' has only {nunique} unique value(s) ({val}) and carries no information; consider dropping it",
            })

    total = max(len(df.columns), 1)
    score = round(100 * (1 - constant_cols / total), 2)
    return {"score": max(score, 0), "issues": issues}


# --- Dimension 9: Distribution skew ---

def check_distribution_skew(df: pd.DataFrame) -> dict:
    issues = []
    num_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    skewed_cols = 0

    for col in num_cols:
        series = df[col].dropna()
        if len(series) < 8:
            continue
        skewness = float(series.skew())
        if abs(skewness) > 3:
            skewed_cols += 1
            direction = "right-skewed (positive)" if skewness > 0 else "left-skewed (negative)"
            issues.append({
                "column": col,
                "skewness": round(skewness, 4),
                "direction": direction,
                "suggestion": f"Skewness = {skewness:.2f} ({direction}); the distribution is extremely asymmetric, consider a log or Box-Cox transform",
            })
        elif abs(skewness) > 1:
            issues.append({
                "column": col,
                "skewness": round(skewness, 4),
                "direction": "mildly right-skewed" if skewness > 0 else "mildly left-skewed",
                "suggestion": f"Skewness = {skewness:.2f}; the distribution is slightly skewed, consider a transform if used for regression",
            })

    total = max(len(num_cols), 1)
    score = round(100 * (1 - skewed_cols / total), 2)
    return {"score": max(score, 0), "issues": issues}


# --- Dimension 10: Column naming conventions ---

def check_column_naming(df: pd.DataFrame) -> dict:
    issues = []
    problem_cols = 0
    CLEAN_RE = re.compile(r"^[^\W\d]\w*$")

    for col in df.columns:
        problems = []
        col_str = str(col)

        if col_str != col_str.strip():
            problems.append("has leading or trailing spaces")
        if " " in col_str.strip():
            problems.append("contains spaces")
        if not CLEAN_RE.match(col_str.strip()):
            problems.append("contains special characters")
        if col_str != col_str.lower() and col_str != col_str.upper() and "_" not in col_str:
            pass

        if problems:
            problem_cols += 1
            issues.append({
                "column": col_str,
                "problems": problems,
                "suggestion": f"Column name '{col_str}' {'; '.join(problems)}; consider renaming to snake_case",
            })

    has_mixed_case = False
    col_styles = set()
    for col in df.columns:
        c = str(col).strip()
        if c == c.lower():
            col_styles.add("lower")
        elif c == c.upper():
            col_styles.add("upper")
        else:
            col_styles.add("mixed")
    if len(col_styles) > 1:
        has_mixed_case = True
        issues.append({
            "column": "(global)",
            "problems": ["inconsistent letter case style"],
            "styles_found": list(col_styles),
            "suggestion": "Column names use inconsistent letter case; consider standardizing on snake_case",
        })

    total = max(len(df.columns), 1)
    penalty = problem_cols + (1 if has_mixed_case else 0)
    score = round(100 * (1 - penalty / (total + 1)), 2)
    return {"score": max(score, 0), "issues": issues}


# --- Dimension 11: Cardinality anomalies ---

def check_cardinality(df: pd.DataFrame) -> dict:
    issues = []
    problem_cols = 0

    for col in df.columns:
        non_null = df[col].dropna()
        if len(non_null) == 0:
            continue
        nunique = non_null.nunique()
        ratio = nunique / len(non_null)

        if pd.api.types.is_numeric_dtype(df[col]):
            if nunique <= 2 and len(non_null) > 20:
                problem_cols += 1
                issues.append({
                    "column": col,
                    "unique_values": nunique,
                    "total_values": len(non_null),
                    "suggestion": f"Numeric column '{col}' has only {nunique} unique values and may be a categorical variable",
                })
        else:
            if ratio > 0.95 and len(non_null) > 50:
                problem_cols += 1
                issues.append({
                    "column": col,
                    "unique_values": nunique,
                    "total_values": len(non_null),
                    "cardinality_ratio": round(ratio, 4),
                    "suggestion": f"Text column '{col}' has very high cardinality ({nunique}/{len(non_null)}); "
                                  f"it may be free text rather than a categorical field, please check",
                })

    total = max(len(df.columns), 1)
    score = round(100 * (1 - problem_cols / total), 2)
    return {"score": max(score, 0), "issues": issues}


# --- Dimension 12: Cross-column consistency ---

def check_cross_column(df: pd.DataFrame) -> dict:
    issues = []
    checks_done = 0
    problems = 0

    col_lower_map = {col: col.lower().replace(" ", "_") for col in df.columns}
    cols_list = list(df.columns)

    EARLIER_LATER_KEYWORDS = [
        (["start", "begin", "from"], ["end", "finish", "to"]),
        (["create", "signup", "register", "open", "birth"], ["update", "modify", "close", "last_login", "login", "expire"]),
    ]

    date_pairs = []
    for i, c1 in enumerate(cols_list):
        for c2 in cols_list[i + 1:]:
            l1, l2 = col_lower_map[c1], col_lower_map[c2]
            matched = False
            for earlier_kws, later_kws in EARLIER_LATER_KEYWORDS:
                if any(k in l1 for k in earlier_kws) and any(k in l2 for k in later_kws):
                    matched = True
                    break
            if not matched:
                if ("min" in l1 and "max" in l2) and l1.replace("min", "") == l2.replace("max", ""):
                    matched = True
            if matched:
                date_pairs.append((c1, c2))

    for c1, c2 in date_pairs:
        checks_done += 1
        try:
            s1 = pd.to_numeric(df[c1], errors="coerce")
            s2 = pd.to_numeric(df[c2], errors="coerce")
            if s1.isna().all() or s2.isna().all():
                s1 = pd.to_datetime(df[c1], errors="coerce")
                s2 = pd.to_datetime(df[c2], errors="coerce")

            valid = s1.notna() & s2.notna()
            if valid.sum() == 0:
                continue
            violations = int((s1[valid] > s2[valid]).sum())
            if violations > 0:
                problems += 1
                pct = round(violations / valid.sum() * 100, 2)
                issues.append({
                    "columns": [c1, c2],
                    "violation_count": violations,
                    "violation_pct": pct,
                    "suggestion": f"'{c1}' should be <= '{c2}', but {violations} rows ({pct}%) violate this constraint; please check",
                })
        except Exception:
            pass

    num_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    for i, c1 in enumerate(num_cols):
        for c2 in num_cols[i + 1:]:
            l1, l2 = col_lower_map.get(c1, ""), col_lower_map.get(c2, "")
            if ("price" in l1 and "discount" in l2) or ("total" in l1 and "tax" in l2):
                checks_done += 1
                valid = df[c1].notna() & df[c2].notna()
                if valid.sum() == 0:
                    continue
                violations = int((df[c2][valid] > df[c1][valid]).sum())
                if violations > 0:
                    problems += 1
                    issues.append({
                        "columns": [c1, c2],
                        "violation_count": violations,
                        "suggestion": f"'{c2}' should not be greater than '{c1}', but {violations} rows violate this",
                    })

    if checks_done == 0:
        return {"score": 100.0, "issues": [], "note": "No checkable column pairs detected; cross-column check skipped"}

    score = round(100 * (1 - problems / checks_done), 2)
    return {"score": max(score, 0), "issues": issues}


# --- Summary ---

def compute_overall_score(results: dict) -> float:
    total_weight = sum(DIMENSION_WEIGHTS.values())
    weighted_sum = 0
    for dim, weight in DIMENSION_WEIGHTS.items():
        dim_score = results.get(dim, {}).get("score", 100.0)
        weighted_sum += dim_score * weight
    return round(weighted_sum / total_weight, 2)


def collect_top_suggestions(results: dict, top_n: int = 10) -> list[str]:
    all_suggestions = []
    for dim_name, dim_result in results.items():
        for issue in dim_result.get("issues", []):
            suggestion = issue.get("suggestion", "")
            if suggestion:
                all_suggestions.append(suggestion)
    return all_suggestions[:top_n]


def main():
    parser = argparse.ArgumentParser(
        description="Data quality checker: 12-dimension quality checks with scores and fix suggestions"
    )
    parser.add_argument("input", help="Input data file path (CSV/TSV/Excel/JSON)")
    parser.add_argument("--output", "-o", default=None, help="Output JSON report path")
    parser.add_argument("--id-columns", "-id", default=None, help="ID column names that should be unique, comma-separated")
    parser.add_argument("--date-columns", "-dc", default=None, help="Date column names, comma-separated")
    parser.add_argument("--sample", "-s", type=int, default=None, help="Number of rows to sample (for large files)")
    parser.add_argument("--encoding", "-e", default="utf-8", help="File encoding (default utf-8)")

    args = parser.parse_args()

    if not os.path.isfile(args.input):
        print(f"Error: file not found - {args.input}", file=sys.stderr)
        sys.exit(1)

    try:
        df = load_data(args.input, encoding=args.encoding, sample=args.sample)
    except Exception as e:
        print(f"Error: cannot read file - {e}", file=sys.stderr)
        sys.exit(1)

    if df.empty:
        print("Error: file is empty or has no valid data", file=sys.stderr)
        sys.exit(1)

    id_cols = None
    if args.id_columns:
        id_cols = [c.strip() for c in args.id_columns.split(",")]

    print(f"Starting quality check: {len(df)} rows x {len(df.columns)} columns", file=sys.stderr)

    dimensions = {}
    dimensions["missing_values"] = check_missing_values(df)
    dimensions["duplicates"] = check_duplicates(df)
    dimensions["type_consistency"] = check_type_consistency(df)
    dimensions["value_range"] = check_value_range(df)
    dimensions["format_compliance"] = check_format_compliance(df)
    dimensions["uniqueness"] = check_uniqueness(df, id_cols)
    dimensions["whitespace"] = check_whitespace(df)
    dimensions["constant_columns"] = check_constant_columns(df)
    dimensions["distribution_skew"] = check_distribution_skew(df)
    dimensions["column_naming"] = check_column_naming(df)
    dimensions["cardinality"] = check_cardinality(df)
    dimensions["cross_column"] = check_cross_column(df)

    overall = compute_overall_score(dimensions)
    grade = score_to_grade(overall)

    report = {
        "file": os.path.basename(args.input),
        "rows": len(df),
        "columns": len(df.columns),
        "column_list": list(df.columns),
        "overall_score": overall,
        "grade": grade,
        "dimensions": dimensions,
        "top_suggestions": collect_top_suggestions(dimensions),
    }

    output_json = json.dumps(report, ensure_ascii=False, indent=2, default=str)

    if args.output:
        out_dir = os.path.dirname(args.output)
        if out_dir and not os.path.isdir(out_dir):
            os.makedirs(out_dir, exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output_json)
        print(f"Report saved to {args.output}", file=sys.stderr)
    else:
        print(output_json)

    print(f"Quality check complete: overall score {overall}/100 ({grade})", file=sys.stderr)


if __name__ == "__main__":
    main()
