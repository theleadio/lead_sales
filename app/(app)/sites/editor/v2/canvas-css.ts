// Editor-only stylesheet injected into the canvas iframe (never published).
export const CANVAS_CSS = `
html,body{margin:0}
body{background:#fff}

.lp a,.lp summary,.lp button{cursor:default}
.lp iframe{pointer-events:none}
.lp .col:empty::before{content:"Empty column \\2014  click \\FF0B  to add an element";display:block;text-align:center;padding:18px;border:1px dashed #cbd5e1;border-radius:8px;color:#64748b;font:13px Inter,system-ui,sans-serif}
.lp .wrap:empty::before{content:"Empty section \\2014  click \\FF0B  to add";display:block;text-align:center;padding:18px;border:1px dashed #cbd5e1;border-radius:8px;color:#64748b;font:13px Inter,system-ui,sans-serif}
.lp [contenteditable="true"]{outline:2px solid #ea580c;outline-offset:3px;cursor:text;min-width:1em}
.mv{color:#9333ea;background:#f3e8ff;border-radius:4px;padding:0 3px;font-weight:600}
body[data-dev="d"] .lp .sec.hide-d,body[data-dev="t"] .lp .sec.hide-t,body[data-dev="m"] .lp .sec.hide-m{display:block!important;padding:10px 24px!important;background:repeating-linear-gradient(45deg,#f1f5f9 0 8px,#e2e8f0 8px 16px)!important;text-align:center;color:#475569;font:600 12px Inter,system-ui,sans-serif}
body[data-dev="d"] .lp .sec.hide-d>.wrap,body[data-dev="t"] .lp .sec.hide-t>.wrap,body[data-dev="m"] .lp .sec.hide-m>.wrap{display:none}
body[data-dev="d"] .lp .sec.hide-d::before,body[data-dev="t"] .lp .sec.hide-t::before,body[data-dev="m"] .lp .sec.hide-m::before{content:"Hidden on this device"}
body.popmode{background:rgba(15,23,42,.55);min-height:560px}
.popwrap{padding:80px 12px 40px}
.pop{background:#fff;border-radius:16px;width:min(520px,100%);margin:0 auto;box-shadow:0 20px 60px rgba(0,0,0,.35);overflow:hidden}
`;
