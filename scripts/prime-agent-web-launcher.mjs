#!/usr/bin/env node

import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import webServer from "./server/server.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;
const clientRoot = resolve(fileURLToPath(new URL("./client/", import.meta.url)));

const options = parseArgs(process.argv.slice(2));
const httpServer = createServer((request, response) => {
	void handleRequest(request, response);
});

let shuttingDown = false;

httpServer.on("error", (error) => {
	if (!shuttingDown) {
		console.error(`Web server error: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
});

await listen(httpServer, options.host, options.port);
const address = httpServer.address();
if (!address || typeof address === "string") {
	throw new Error("Web server did not report a TCP address");
}
console.log(`Prime Agent web interface: http://${formatHost(address.address)}:${address.port}`);

const shutdown = (signal) => {
	if (shuttingDown) return;
	shuttingDown = true;
	process.exitCode = signal === "SIGINT" ? 130 : 143;
	httpServer.close(() => {
		process.exitCode = signal === "SIGINT" ? 130 : 143;
	});
	httpServer.closeIdleConnections?.();
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

async function handleRequest(request, response) {
	try {
		const requestUrl = new URL(request.url || "/", `http://${request.headers.host || `${options.host}:${options.port}`}`);
		const staticPath = resolveStaticPath(requestUrl.pathname);
		if (staticPath) {
			serveStaticFile(request, response, staticPath);
			return;
		}

		const headers = new Headers();
		for (const [name, value] of Object.entries(request.headers)) {
			if (Array.isArray(value)) {
				for (const item of value) headers.append(name, item);
			} else if (value !== undefined) {
				headers.set(name, value);
			}
		}

		const hasBody = request.method !== "GET" && request.method !== "HEAD";
		const webRequest = new Request(requestUrl, {
			method: request.method,
			headers,
			body: hasBody ? Readable.toWeb(request) : undefined,
			duplex: hasBody ? "half" : undefined,
		});
		const webResponse = await webServer.fetch(webRequest);

		response.statusCode = webResponse.status;
		const cookies = webResponse.headers.getSetCookie?.();
		for (const [name, value] of webResponse.headers) {
			if (name === "set-cookie") continue;
			response.setHeader(name, value);
		}
		if (cookies && cookies.length > 0) response.setHeader("set-cookie", cookies);

		if (!webResponse.body || request.method === "HEAD") {
			response.end();
			return;
		}
		Readable.fromWeb(webResponse.body).pipe(response);
	} catch (error) {
		if (response.headersSent) {
			response.destroy(error instanceof Error ? error : undefined);
			return;
		}
		response.statusCode = 500;
		response.setHeader("content-type", "text/plain; charset=utf-8");
		response.end(error instanceof Error ? error.message : String(error));
		console.error(`Web request failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
	}
}

function resolveStaticPath(pathname) {
	let decodedPath;
	try {
		decodedPath = decodeURIComponent(pathname);
	} catch {
		return undefined;
	}
	const candidate = resolve(clientRoot, `.${decodedPath}`);
	const relativePath = relative(clientRoot, candidate);
	if (relativePath.startsWith(`..${sep}`) || relativePath === ".." || relativePath.includes(`${sep}..${sep}`)) {
		return undefined;
	}
	if (!existsSync(candidate) || !statSync(candidate).isFile()) return undefined;
	return candidate;
}

function serveStaticFile(request, response, filePath) {
	const stat = statSync(filePath);
	response.statusCode = 200;
	response.setHeader("content-type", contentType(filePath));
	response.setHeader("content-length", stat.size);
	if (request.method === "HEAD") {
		response.end();
		return;
	}
	createReadStream(filePath).on("error", (error) => response.destroy(error)).pipe(response);
}

function contentType(filePath) {
	const types = {
		".css": "text/css; charset=utf-8",
		".gif": "image/gif",
		".html": "text/html; charset=utf-8",
		".ico": "image/x-icon",
		".jpeg": "image/jpeg",
		".jpg": "image/jpeg",
		".js": "text/javascript; charset=utf-8",
		".json": "application/json; charset=utf-8",
		".png": "image/png",
		".svg": "image/svg+xml",
		".txt": "text/plain; charset=utf-8",
		".webp": "image/webp",
		".woff": "font/woff",
		".woff2": "font/woff2",
	};
	return types[extname(filePath).toLowerCase()] || "application/octet-stream";
}

function parseArgs(args) {
	let host = DEFAULT_HOST;
	let port = DEFAULT_PORT;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--host" || arg === "--port") {
			const value = args[index + 1];
			if (!value || value.startsWith("-")) throw new Error(`${arg} requires a value`);
			index += 1;
			if (arg === "--host") host = parseHost(value);
			else port = parsePort(value);
			continue;
		}
		if (arg.startsWith("--host=")) {
			host = parseHost(arg.slice("--host=".length));
			continue;
		}
		if (arg.startsWith("--port=")) {
			port = parsePort(arg.slice("--port=".length));
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			console.log("Usage: prime-agent web [--host <host>] [--port <port>]");
			process.exit(0);
		}
		throw new Error(`Unknown web launcher option: ${arg}`);
	}
	return { host, port };
}

function parseHost(value) {
	const host = value.trim();
	if (!host) throw new Error("--host requires a non-empty value");
	return host;
}

function parsePort(value) {
	if (!/^\d+$/.test(value)) throw new Error(`Invalid web port: ${value}`);
	const port = Number(value);
	if (!Number.isSafeInteger(port) || port < 0 || port > MAX_PORT) {
		throw new Error(`Invalid web port: ${value}. Expected a number between 0 and ${MAX_PORT}.`);
	}
	return port;
}

function formatHost(host) {
	return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function listen(server, host, port) {
	return new Promise((resolvePromise, reject) => {
		const onError = (error) => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.off("error", onError);
			resolvePromise();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen({ host, port });
	});
}
