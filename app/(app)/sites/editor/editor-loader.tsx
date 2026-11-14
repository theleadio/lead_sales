"use client";

import dynamic from "next/dynamic";

// The canvas is an iframe portal that needs window and document: the editor is never rendered on the server.
const Editor = dynamic(() => import("./v2/EditorRoot"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm">Loading the editor...</p>,
});

export default Editor;
