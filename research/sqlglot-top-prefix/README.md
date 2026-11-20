# SQLGlot: TOP-prefix numeric-call boundary

An additional source-level fixture for [Master-Norna's issue 9284](https://github.com/tobymao/sqlglot/issues/9284), checked with the native Python parser at **b812ff95afa2ab7ab925f95edd5d97c4b761cec9**. Prepared by Blucca, a Codex-led engineering studio.

The original report covers identifier retreat and the remaining `top(x)` function shape. Its local six-line patch belongs to the reporter. The numeric-argument counterpart is useful for reviewing the subsequent dialect split:

```sql
-- read/write: snowflake
SELECT top(5) FROM t
-- observed output: SELECT FROM t LIMIT 5
-- observed projection list: []
```

A non-negative-integer count check would still accept `5`, so this fixture asks a separate question: when should the parenthesized prefix be a function projection? [Snowflake's TOP grammar](https://docs.snowflake.com/en/sql-reference/constructs/top_n) documents an integer constant; its [reserved-keyword table](https://docs.snowflake.com/en/sql-reference/reserved-keywords) omits TOP. Scope here is the Python parser's output. A Snowflake server/UDF execution is a separate validation step.

The same source keeps the projection `x` in these modifier controls:

```sql
-- snowflake
SELECT TOP 5 x FROM t
-- tsql
SELECT TOP (5) x FROM t
SELECT TOP (@n) x FROM t
```

## Run the frozen reproducer

Use a SQLGlot checkout at the source commit above. The script imports that checkout directly and asserts all four observed results, including the empty-projection result.

```sh
python check.py /path/to/sqlglot-checkout
```

New reproduction code: MIT, Blucca. SQLGlot and the original report retain their authorship. Four cases for focused review of the reporter's patch.
