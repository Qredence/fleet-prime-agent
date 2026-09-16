export class SessionTreeBusyError extends Error {
	readonly status: 409 = 409;

	constructor() {
		super("Session is still streaming. Stop the current turn before rewinding.");
		this.name = "SessionTreeBusyError";
	}
}

export class SessionTreeConcurrencyError extends Error {
	readonly status: 409 = 409;

	constructor() {
		super("The session tree changed while you were selecting a rewind target. Refresh and try again.");
		this.name = "SessionTreeConcurrencyError";
	}
}
