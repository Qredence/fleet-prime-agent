import type { ChatSessionMetadata } from "@prime-agent/web-protocol/chat-protocol";
import type { OpenPanelAction } from "@prime-agent/web-protocol/fleet-contract";
import { createContext, useContext } from "react";

export type OpenUISessionContextValue = ChatSessionMetadata & {
	onOpenPanelAction?: (action: OpenPanelAction) => void;
};

export const OpenUISessionContext = createContext<OpenUISessionContextValue>({});
export const useOpenUISession = () => useContext(OpenUISessionContext);
