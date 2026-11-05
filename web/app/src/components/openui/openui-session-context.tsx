import type { ChatSessionMetadata } from "@prime-agent/web-protocol/chat-protocol";
import { createContext, useContext } from "react";

export const OpenUISessionContext = createContext<ChatSessionMetadata>({});
export const useOpenUISession = () => useContext(OpenUISessionContext);
