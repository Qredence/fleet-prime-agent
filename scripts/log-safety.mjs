/**
 * Removes control characters from values written to logs (Sonar jssecurity:S5145).
 * @param {unknown} value - Value to render in a log line.
 * @returns {string} Single-line safe representation.
 */
export function sanitizeLogField(value) {
	return String(value).replace(/[\0-\x1f\x7f]/g, "?");
}
