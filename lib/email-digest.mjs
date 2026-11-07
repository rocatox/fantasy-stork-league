export const EMAIL_DIGEST_MS=15*60000;
// Fixed SQL, never interpolated user input. Actionable categories bypass digest delay.
export const EMAIL_URGENT_SQL="(json_extract(payload,'$.category') IN ('replacements','deadlines') OR (json_extract(payload,'$.category')='draft' AND json_extract(payload,'$.title')='Your pick') OR (json_extract(payload,'$.category')='trades' AND json_extract(payload,'$.title')='Trade proposal'))";
