import { complete, getModel } from "@earendil-works/pi-ai";
import * as protocol from "../web/protocol/src/index";

const model = getModel("google", "gemini-2.5-flash");
console.log(model.id, typeof complete, Object.keys(protocol));
