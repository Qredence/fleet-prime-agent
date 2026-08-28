import { type PrimeAgentArtifact, validateAndNormalizeOpenUIHtmlArtifact } from "@prime-agent/web-protocol";
import { ChatOpenUIArtifactUpsertRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { stablePresentationId } from "../prime-agent-presentation";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function artifactIndexFor(artifact: PrimeAgentArtifact): number | undefined {
	const input = record(artifact.input);
	return typeof input?.artifactIndex === "number" ? input.artifactIndex : undefined;
}

export function handleChatOpenUIArtifactPut(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const raw = await request.json().catch(() => ({}));
		const parsed = ChatOpenUIArtifactUpsertRequestSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json({ message: "Invalid OpenUI artifact request." }, { status: 400 });
		}
		const body = parsed.data;
		const validation = validateAndNormalizeOpenUIHtmlArtifact(body.artifact);
		if (!validation.ok) {
			return Response.json({ message: validation.reason }, { status: validation.status ?? 400 });
		}

		const bridge = getBridge();
		const session = bridge.getSession(body.sessionId) ?? (await bridge.resumeSessionById(body.sessionId));
		if (!session) return Response.json({ message: `Unknown session: ${body.sessionId}` }, { status: 404 });

		const messages = await bridge.getMessages(session.sessionId);
		const incomingId = body.assistantMessageId;
		const exact = messages.find((message) => message.role === "assistant" && message.id === incomingId);
		const storedArtifacts = bridge
			.getPresentation(session.sessionId)
			.artifactRuns.flatMap((run) => run.artifacts)
			.filter((artifact) => artifact.kind === "openui-html");
		const existing = storedArtifacts.find(
			(artifact) =>
				artifactIndexFor(artifact) === body.artifactIndex &&
				(record(artifact.input)?.clientMessageId === incomingId || artifact.sourceMessageId === incomingId),
		);
		const fallback = existing ? undefined : [...messages].reverse().find((message) => message.role === "assistant");
		const assistantMessageId = exact?.id ?? existing?.sourceMessageId ?? fallback?.id;
		if (!assistantMessageId) {
			return Response.json(
				{ message: "Unable to associate OpenUI artifact with an assistant message." },
				{ status: 409 },
			);
		}

		const artifact: PrimeAgentArtifact = {
			id: stablePresentationId(`${assistantMessageId}:openui-html:${body.artifactIndex}`),
			runId: stablePresentationId(`${assistantMessageId}:openui`),
			sourceMessageId: assistantMessageId,
			kind: "openui-html",
			title: validation.value.title,
			status: "success",
			input: { clientMessageId: incomingId, artifactIndex: body.artifactIndex },
			output: validation.value,
			timestamp: Date.now(),
		};
		const presentation = await bridge.upsertPresentationArtifact(session.sessionId, artifact);
		return Response.json({ artifact, presentation });
	});
}
