import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("找不到应用挂载点");
createRoot(root).render(<App />);
