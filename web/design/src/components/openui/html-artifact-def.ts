import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { HtmlArtifactComponent } from "./html-artifact";

export const HtmlArtifactDef = defineComponent({
	name: "HtmlArtifact",
	description: "A durable, self-contained HTML artifact rendered in a sandboxed preview.",
	props: z.object({
		title: z.string().describe("Short artifact title"),
		document: z.string().describe("Complete self-contained HTML document"),
	}),
	component: HtmlArtifactComponent,
});
