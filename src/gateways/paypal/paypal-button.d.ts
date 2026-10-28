import type { DetailedHTMLProps, HTMLAttributes } from "react"

// `<paypal-button>` is a custom element that PayPal's JS SDK registers once it
// has loaded the `paypal-payments` component.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "paypal-button": DetailedHTMLProps<
        HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        type?: "buynow" | "checkout" | "donate" | "pay" | "subscribe"
        disabled?: boolean
      }
    }
  }
}
