import { describe, expect, it } from "vitest";
import {
	COMPOSER_INTENT_CODE_TASK_MAX,
	COMPOSER_INTENT_COMMANDS,
	COMPOSER_INTENT_EXECUTE_GATE,
	COMPOSER_INTENT_FLOOR,
	composerIntentCommand,
	decideComposerIntent,
} from "../composer-intent";

const autoCommand = COMPOSER_INTENT_COMMANDS.find((c) => c.autoExecutable)?.id ?? "";
const manualCommand = COMPOSER_INTENT_COMMANDS.find((c) => !c.autoExecutable && c.handling === "local")?.id ?? "";
const sessionCommand = COMPOSER_INTENT_COMMANDS.find((c) => c.handling === "session")?.id ?? "";

describe("COMPOSER_INTENT_COMMANDS", () => {
	it("has no duplicate ids", () => {
		const ids = COMPOSER_INTENT_COMMANDS.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("keeps session-handled commands out of the auto band", () => {
		for (const command of COMPOSER_INTENT_COMMANDS) {
			if (command.handling === "session") expect(command.autoExecutable).toBe(false);
		}
	});

	it("gives every command a real description rather than its id", () => {
		for (const command of COMPOSER_INTENT_COMMANDS) {
			expect(command.description.trim()).not.toBe(command.id);
			expect(command.description.trim().length).toBeGreaterThan(10);
		}
	});

	it("resolves catalog ids through composerIntentCommand", () => {
		expect(composerIntentCommand("compact")?.handling).toBe("session");
		expect(composerIntentCommand("context")?.autoExecutable).toBe(true);
		expect(composerIntentCommand("not-a-command")).toBeUndefined();
		expect(composerIntentCommand(undefined)).toBeUndefined();
	});

	it("provides the fixtures this suite depends on", () => {
		expect(autoCommand).not.toBe("");
		expect(manualCommand).not.toBe("");
		expect(sessionCommand).not.toBe("");
	});
});

describe("decideComposerIntent", () => {
	it("refuses routing when the utterance is engineering work", () => {
		// The code-task guard runs before the confidence bands, so a fully
		// confident match still falls through when the text is real work.
		expect(decideComposerIntent({ command: autoCommand, confidence: 1, codeTaskProbability: 1 })).toEqual({
			outcome: "none",
			reason: "code_task",
		});
	});

	it("treats the code-task guard as inclusive at its threshold", () => {
		expect(
			decideComposerIntent({
				command: autoCommand,
				confidence: 1,
				codeTaskProbability: COMPOSER_INTENT_CODE_TASK_MAX,
			}),
		).toEqual({ outcome: "none", reason: "code_task" });
		expect(
			decideComposerIntent({
				command: autoCommand,
				confidence: 1,
				codeTaskProbability: COMPOSER_INTENT_CODE_TASK_MAX - 0.01,
			}).outcome,
		).toBe("matched");
	});

	it("refuses an explicit no-match and an unknown command", () => {
		expect(decideComposerIntent({ command: "none", confidence: 1, codeTaskProbability: 0 })).toEqual({
			outcome: "none",
			reason: "no_match",
		});
		expect(decideComposerIntent({ command: undefined, confidence: 1, codeTaskProbability: 0 })).toEqual({
			outcome: "none",
			reason: "no_match",
		});
		expect(decideComposerIntent({ command: "not-a-command", confidence: 1, codeTaskProbability: 0 })).toEqual({
			outcome: "none",
			reason: "no_match",
		});
	});

	it("sends low-confidence matches to normal chat", () => {
		expect(
			decideComposerIntent({
				command: autoCommand,
				confidence: COMPOSER_INTENT_FLOOR - 0.01,
				codeTaskProbability: 0,
			}),
		).toEqual({ outcome: "none", reason: "below_floor" });
	});

	it("executes an auto-executable command at the execute gate, and suggests just below it", () => {
		expect(
			decideComposerIntent({
				command: autoCommand,
				confidence: COMPOSER_INTENT_EXECUTE_GATE,
				codeTaskProbability: 0,
			}),
		).toMatchObject({ outcome: "matched", disposition: "execute", command: { id: autoCommand } });
		expect(
			decideComposerIntent({
				command: autoCommand,
				confidence: COMPOSER_INTENT_EXECUTE_GATE - 0.01,
				codeTaskProbability: 0,
			}),
		).toMatchObject({ outcome: "matched", disposition: "suggest" });
	});

	it("never executes a non-auto command, however confident", () => {
		for (const command of [manualCommand, sessionCommand]) {
			expect(decideComposerIntent({ command, confidence: 1, codeTaskProbability: 0 })).toMatchObject({
				outcome: "matched",
				disposition: "suggest",
			});
		}
	});

	it("walks the confidence bands in order", () => {
		const at = (confidence: number) =>
			decideComposerIntent({ command: autoCommand, confidence, codeTaskProbability: 0 });
		expect(at(0)).toEqual({ outcome: "none", reason: "below_floor" });
		expect(at(COMPOSER_INTENT_FLOOR)).toMatchObject({ outcome: "matched", disposition: "suggest" });
		expect(at(0.7)).toMatchObject({ outcome: "matched", disposition: "suggest" });
		expect(at(COMPOSER_INTENT_EXECUTE_GATE)).toMatchObject({ outcome: "matched", disposition: "execute" });
		expect(at(1)).toMatchObject({ outcome: "matched", disposition: "execute" });
	});
});
