/** Maximum UTF-8 size of a persisted OpenUI HTML document. */
export const MAX_OPENUI_HTML_ARTIFACT_BYTES = 1_048_576;

export type OpenUIHtmlArtifactPayload = {
	title: string;
	document: string;
};

export type OpenUIHtmlArtifactValidation =
	| { ok: true; value: OpenUIHtmlArtifactPayload }
	| { ok: false; reason: string; status?: 400 | 413 };

const CSP =
	"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; media-src data:; navigate-to 'none';";
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
const MAX_TITLE_BYTES = 240;

const FORBIDDEN_ELEMENTS = /<(?:link|iframe|object|embed|base|form|portal|frameset)\b/i;
const META_TAG = /<meta\b[^>]*>/gi;
const REFRESH_META = /\bhttp-equiv\s*=\s*["']?\s*refresh\b/i;
const CSP_META_REFERENCE = /\bcontent-security-policy\b/i;
const EVENT_HANDLER_ATTRIBUTE = /\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i;
const SCRIPT_SOURCE_ATTRIBUTE = /<script\b[^>]*\bsrc\s*=/i;
const CSS_IMPORT = /@import\b/i;
const CSS_URL = /url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi;
const NETWORK_API =
	/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|showModalDialog)\s*\(|\bwindow\s*\.\s*open\s*\(|\b(?:window|globalThis|document|location)\s*\.\s*(?:location|assign|replace|reload|href|pathname|host|hostname|port|protocol|search|hash)\s*=|\b(?:window|globalThis|document|location)\s*\.\s*(?:location\s*\.\s*)?(?:assign|replace|reload)\s*\(/i;
const RESOURCE_ATTRIBUTE =
	/\b(?:src|href|action|formaction|poster|cite|background|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const UNSAFE_SCHEME =
	/^(?:javascript|vbscript|file|blob|filesystem|about|data:text\/html|data:application\/javascript):/i;

interface HtmlTag {
	raw: string;
	name: string;
	closing: boolean;
	start: number;
	end: number;
}

function byteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function safeResourceUrl(value: string): boolean {
	const normalized = value.trim();
	if (!normalized || UNSAFE_SCHEME.test(normalized)) return false;
	if (normalized.startsWith("#")) return true;
	return /^(?:data:image\/(?:gif|jpeg|jpg|png|webp|svg\+xml);|data:(?:audio|video)\/)/i.test(normalized);
}

function scanHtmlTags(document: string): HtmlTag[] {
	const tags: HtmlTag[] = [];
	let index = 0;
	let rawTextElement: "script" | "style" | undefined;

	while (index < document.length) {
		if (rawTextElement) {
			const closingTag = new RegExp(`<\\/\\s*${rawTextElement}\\b[^>]*>`, "ig");
			closingTag.lastIndex = index;
			const closingMatch = closingTag.exec(document);
			if (!closingMatch) break;
			index = closingMatch.index;
			rawTextElement = undefined;
		}

		const start = document.indexOf("<", index);
		if (start < 0) break;
		if (document.startsWith("<!--", start)) {
			const commentEnd = document.indexOf("-->", start + 4);
			index = commentEnd < 0 ? document.length : commentEnd + 3;
			continue;
		}

		let end = start + 1;
		let quote: '"' | "'" | undefined;
		for (; end < document.length; end += 1) {
			const character = document[end];
			if (quote) {
				if (character === quote) quote = undefined;
				continue;
			}
			if (character === '"' || character === "'") {
				quote = character;
				continue;
			}
			if (character === ">") break;
		}
		if (end >= document.length) break;

		const raw = document.slice(start, end + 1);
		const tagMatch = /^<\s*(\/?)\s*([A-Za-z][\w:-]*)\b/i.exec(raw);
		if (!tagMatch) {
			index = end + 1;
			continue;
		}
		const closing = Boolean(tagMatch[1]);
		const name = tagMatch[2]!.toLowerCase();
		tags.push({ raw, name, closing, start, end: end + 1 });
		if (!closing && (name === "script" || name === "style") && !/\/\s*>$/.test(raw)) {
			rawTextElement = name;
		}
		index = end + 1;
	}

	return tags;
}

function hasHtmlAttribute(document: string, expectedAttribute: string): boolean {
	let inTag = false;
	let quote: '"' | "'" | undefined;
	let tagStart = -1;

	for (let index = 0; index < document.length; index += 1) {
		const character = document[index];
		if (!inTag) {
			if (character === "<") {
				inTag = true;
				tagStart = index;
			}
			continue;
		}

		if (quote) {
			if (character === quote) quote = undefined;
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}
		if (character !== ">") continue;

		const tag = document.slice(tagStart, index + 1);
		inTag = false;
		if (/^<\s*\//.test(tag) || /^<\s*[!/?]/.test(tag)) continue;

		const tagName = /^<\s*[A-Za-z][\w:-]*/.exec(tag);
		if (!tagName) continue;
		const attributes = tag.slice(tagName[0].length, -1);
		let attributeIndex = 0;
		while (attributeIndex < attributes.length) {
			while (/\s/.test(attributes[attributeIndex] ?? "")) attributeIndex += 1;
			if (attributeIndex >= attributes.length || attributes[attributeIndex] === "/") break;
			const nameStart = attributeIndex;
			while (!/[\s=/>]/.test(attributes[attributeIndex] ?? "")) attributeIndex += 1;
			const name = attributes.slice(nameStart, attributeIndex);
			if (name.toLowerCase() === expectedAttribute.toLowerCase()) return true;
			while (/\s/.test(attributes[attributeIndex] ?? "")) attributeIndex += 1;
			if (attributes[attributeIndex] !== "=") continue;
			attributeIndex += 1;
			while (/\s/.test(attributes[attributeIndex] ?? "")) attributeIndex += 1;
			const valueQuote = attributes[attributeIndex];
			if (valueQuote === '"' || valueQuote === "'") {
				attributeIndex += 1;
				while (attributeIndex < attributes.length && attributes[attributeIndex] !== valueQuote) {
					attributeIndex += 1;
				}
				attributeIndex += 1;
				continue;
			}
			while (attributeIndex < attributes.length && !/[\s>]/.test(attributes[attributeIndex] ?? "")) {
				attributeIndex += 1;
			}
		}
	}

	return false;
}

function hasUnsafeResourceAttribute(document: string): boolean {
	RESOURCE_ATTRIBUTE.lastIndex = 0;
	for (const match of document.matchAll(RESOURCE_ATTRIBUTE)) {
		const value = match[1] ?? match[2] ?? match[3] ?? "";
		if (!safeResourceUrl(value)) return true;
	}
	return false;
}

function hasUnsafeCssUrl(document: string): boolean {
	CSS_URL.lastIndex = 0;
	for (const match of document.matchAll(CSS_URL)) {
		if (!safeResourceUrl(match[2] ?? "")) return true;
	}
	return false;
}

function hasForbiddenMeta(document: string): boolean {
	META_TAG.lastIndex = 0;
	for (const match of document.matchAll(META_TAG)) {
		const tag = match[0] ?? "";
		if (REFRESH_META.test(tag)) return true;
		if (CSP_META_REFERENCE.test(tag) && tag !== CSP_META) return true;
	}
	return false;
}

function hasCanonicalCspMetaInHead(document: string): boolean {
	let headDepth = 0;
	for (const tag of scanHtmlTags(document)) {
		if (tag.name === "head") {
			if (tag.closing) headDepth = Math.max(0, headDepth - 1);
			else headDepth += 1;
			continue;
		}
		if (headDepth > 0 && tag.name === "meta" && !tag.closing && tag.raw === CSP_META) return true;
	}
	return false;
}

function normalizeDocument(document: string): string {
	const trimmed = document.trim();
	if (hasCanonicalCspMetaInHead(trimmed)) return trimmed;
	const tags = scanHtmlTags(trimmed);
	const htmlTag = tags.find((tag) => tag.name === "html" && !tag.closing);
	if (!htmlTag) {
		return `<!doctype html><html><head>${CSP_META}</head><body>${trimmed}</body></html>`;
	}
	const headTag = tags.find((tag) => tag.name === "head" && !tag.closing);
	if (headTag) {
		return `${trimmed.slice(0, headTag.end)}${CSP_META}${trimmed.slice(headTag.end)}`;
	}
	return `${trimmed.slice(0, htmlTag.end)}<head>${CSP_META}</head>${trimmed.slice(htmlTag.end)}`;
}

/**
 * Validate and normalize generated HTML without executing or parsing it in the
 * host document. The resulting document is suitable for an allow-scripts,
 * opaque-origin iframe and contains its own restrictive CSP.
 */
export function validateAndNormalizeOpenUIHtmlArtifact(input: unknown): OpenUIHtmlArtifactValidation {
	if (typeof input !== "object" || input === null) {
		return { ok: false, reason: "OpenUI artifact must be an object." };
	}
	const source = input as Record<string, unknown>;
	if (typeof source.title !== "string" || !source.title.trim()) {
		return { ok: false, reason: "OpenUI artifact title is required." };
	}
	if (typeof source.document !== "string" || !source.document.trim()) {
		return { ok: false, reason: "OpenUI artifact document is required." };
	}

	const title = source.title.trim();
	const document = source.document.trim();
	if (byteLength(title) > MAX_TITLE_BYTES) {
		return { ok: false, reason: "OpenUI artifact title is too large." };
	}
	if (byteLength(document) > MAX_OPENUI_HTML_ARTIFACT_BYTES) {
		return { ok: false, reason: "OpenUI artifact exceeds the 1 MiB limit.", status: 413 };
	}
	if (FORBIDDEN_ELEMENTS.test(document)) {
		return { ok: false, reason: "External HTML resources and embedded frames are not allowed." };
	}
	if (hasForbiddenMeta(document)) {
		return { ok: false, reason: "Custom refresh and CSP metadata are not allowed." };
	}
	if (EVENT_HANDLER_ATTRIBUTE.test(document)) {
		return { ok: false, reason: "Inline event-handler attributes are not allowed." };
	}
	if (SCRIPT_SOURCE_ATTRIBUTE.test(document)) {
		return { ok: false, reason: "External scripts are not allowed." };
	}
	if (CSS_IMPORT.test(document) || hasUnsafeCssUrl(document)) {
		return { ok: false, reason: "External styles and CSS resources are not allowed." };
	}
	if (hasUnsafeResourceAttribute(document)) {
		return { ok: false, reason: "External or unsafe resource URLs are not allowed." };
	}
	if (NETWORK_API.test(document)) {
		return { ok: false, reason: "Network access and pop-up APIs are not allowed." };
	}
	if (hasHtmlAttribute(document, "download") || hasHtmlAttribute(document, "target")) {
		return { ok: false, reason: "Downloads and new-window navigation are not allowed." };
	}

	const normalizedDocument = normalizeDocument(document);
	if (byteLength(normalizedDocument) > MAX_OPENUI_HTML_ARTIFACT_BYTES) {
		return { ok: false, reason: "Normalized OpenUI artifact exceeds the 1 MiB limit.", status: 413 };
	}
	return { ok: true, value: { title, document: normalizedDocument } };
}
