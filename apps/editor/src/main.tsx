import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConstructEditor } from "@construct/editor";
import { constructClient } from "./lib/server.ts";
import "./index.css";
import { INITIAL_FLOWS } from "./examples/flows.ts";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <ConstructEditor client={constructClient} slots={{ copilot: null }} initialFlows={INITIAL_FLOWS} />
  </StrictMode>,
);
