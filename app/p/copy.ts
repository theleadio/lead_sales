// The lead form's wording, in the page's language.
export const COPY = {
  en: {
    name: "Your name",
    email: "Email",
    phone: "Phone or WhatsApp",
    contactHint: "An email or a phone number, so we can reach you.",
    consent:
      "I agree to receive course updates and offers from LEAD by email and WhatsApp. I can opt out at any time.",
    privacy: "We use these details to reply to your enquiry.",
    send: "Send",
    sending: "Sending…",
    thanks: "Thanks, we've got it.",
    thanksMore: "Our team will contact you soon.",
    check: "Please check the highlighted fields.",
    tooMany: "Too many requests. Please try again in a while.",
    captcha: "Please complete the check and try again.",
    closed: "This form isn't available right now.",
    failed: "Something went wrong. Please try again.",
    faq: "Questions",
  },
  zh: {
    name: "姓名",
    email: "电邮",
    phone: "电话或 WhatsApp",
    contactHint: "请填写电邮或电话，方便我们联系您。",
    consent:
      "我同意通过电邮和 WhatsApp 接收 LEAD 的课程资讯和优惠。我可以随时取消。",
    privacy: "我们会用这些资料来回复您的查询。",
    send: "提交",
    sending: "提交中…",
    thanks: "谢谢，我们已收到。",
    thanksMore: "我们的团队会尽快联系您。",
    check: "请检查标示的栏位。",
    tooMany: "请求太频繁，请稍后再试。",
    captcha: "请完成验证后再试。",
    closed: "此表格暂时无法使用。",
    failed: "出了点问题，请再试一次。",
    faq: "常见问题",
  },
} as const;
export type Lang = keyof typeof COPY;
