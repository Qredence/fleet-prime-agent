import type { LucideIcon } from "lucide-react";
import { Bot, Brain, Cpu, GitBranch, Globe, Plug, Server, ShieldCheck, Sparkles, Wind, Zap } from "lucide-react";

export type { PiCustomProviderApi } from "@prime-agent/web-protocol/chat-protocol";
export type {
	PiProviderAuthType,
	PiProviderCredentialEntry,
} from "@prime-agent/web-protocol/provider-catalog";

export {
	CREDENTIAL_UI_PROVIDERS,
	CUSTOM_PROVIDER_ID_PREFIX,
	INFRA_PROVIDER_IDS,
	isCustomProviderId,
	isNamedOccInstanceId,
	isOccProviderId,
	KNOWN_PROVIDERS,
	LLM_PROVIDER_ENV_SCRUB_IDS,
	OPENAI_CHAT_COMPLETIONS_BASE_URL_PROVIDER_ID,
	OPENAI_CHAT_COMPLETIONS_MODEL_PROVIDER_ID,
	OPENAI_CHAT_COMPLETIONS_PROVIDER_ID,
	PI_LLM_RUNTIME_PROVIDER_IDS,
	PI_PROVIDER_CATALOG,
	PROVIDER_ENV_SCRUB_VAR_NAMES,
} from "@prime-agent/web-protocol/provider-catalog";

export type PiProviderUiMetadata = {
	icon: LucideIcon;
	placeholder: string;
	help: string;
};

export type PiProviderCatalogEntry = {
	id: string;
	name: string;
	envVarName: string;
	authType?: "apiKey" | "oauth";
	ui?: PiProviderUiMetadata;
};

export const PROVIDER_METADATA: Record<string, PiProviderUiMetadata> = {
	"amazon-bedrock": {
		icon: Server,
		placeholder: "AKIA... (AWS access key id)",
		help: "Amazon Bedrock uses standard AWS credentials (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) plus AWS_REGION. This field sets AWS_ACCESS_KEY_ID in .env.local.",
	},
	openai: {
		icon: Sparkles,
		placeholder: "sk-proj-...",
		help: "Stored securely in your root .env.local file. Overrides the active OPENAI_API_KEY environment variable.",
	},
	"openai-chat-completions": {
		icon: Sparkles,
		placeholder: "sk-... or nvapi-...",
		help: "OpenAI-compatible Chat Completions root (e.g. https://opencode.ai/zen/v1). Paste …/chat/completions if you want — it is normalized. Requires API key, base URL, and model name.",
	},
	"openai-chat-completions-model": {
		icon: Sparkles,
		placeholder: "meta/llama-3.1-70b-instruct",
		help: "Gateway model name registered when /models is empty or incomplete.",
	},
	anthropic: {
		icon: Bot,
		placeholder: "sk-ant-...",
		help: "Stored securely in your root .env.local file. Overrides the active ANTHROPIC_API_KEY environment variable.",
	},
	"google-vertex": {
		icon: ShieldCheck,
		placeholder: "Path to service account JSON, or credentials text...",
		help: "Stored securely in your root .env.local file. Overrides the active GOOGLE_APPLICATION_CREDENTIALS environment variable.",
	},
	google: {
		icon: Brain,
		placeholder: "AIzaSy...",
		help: "Stored securely in your root .env.local file. Overrides the active GEMINI_API_KEY environment variable.",
	},
	mistral: {
		icon: Wind,
		placeholder: "Your Mistral API key...",
		help: "Stored securely in your root .env.local file. Overrides the active MISTRAL_API_KEY environment variable.",
	},
	groq: {
		icon: Zap,
		placeholder: "gsk_...",
		help: "Stored securely in your root .env.local file. Overrides the active GROQ_API_KEY environment variable.",
	},
	openrouter: {
		icon: Globe,
		placeholder: "sk-or-...",
		help: "Stored securely in your root .env.local file. Overrides the active OPENROUTER_API_KEY environment variable.",
	},
	"vercel-ai-gateway": {
		icon: GitBranch,
		placeholder: "Your AI Gateway API key...",
		help: "Stored securely in your root .env.local file. Overrides the active AI_GATEWAY_API_KEY environment variable.",
	},
	"github-copilot": {
		icon: Bot,
		placeholder: "OAuth subscription",
		help: "GitHub Copilot uses subscription OAuth rather than a static API key in Fleet Pi settings.",
	},
	ollama: {
		icon: Cpu,
		placeholder: "http://localhost:11434 (default)",
		help: "Configure local Ollama execution endpoints. Overrides the active OLLAMA_BASE_URL environment variable.",
	},
	custom: {
		icon: Plug,
		placeholder: "sk-... / provider key",
		help: "Register any OpenAI-, Anthropic-, or Google-compatible endpoint through Pi's native custom-provider mechanism. Requires a name, API key, https base URL, API family, and at least one model id. Deployed accounts only.",
	},
};
