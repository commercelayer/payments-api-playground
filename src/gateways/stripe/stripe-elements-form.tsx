"use client";

import {
	Elements,
	PaymentElement,
	useElements,
	useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { forwardRef, useImperativeHandle, useMemo } from "react";

export type StripeFormHandle = {
	triggerConfirm: () => Promise<void>;
};

// Inner form: lives inside Elements provider so it can use Stripe hooks
const StripeInnerForm = forwardRef<StripeFormHandle>(
	function StripeInnerForm(_, ref) {
		const stripe = useStripe();
		const elements = useElements();

		useImperativeHandle(
			ref,
			() => ({
				async triggerConfirm() {
					if (!stripe || !elements) throw new Error("Stripe not ready");

					const { error: submitError } = await elements.submit();
					if (submitError)
						throw new Error(submitError.message ?? "Form validation failed");

					const { error } = await stripe.confirmPayment({
						elements,
						redirect: "if_required",
						confirmParams: {
							// Use origin + pathname to avoid forwarding stale Stripe params
							return_url: window.location.origin + window.location.pathname,
						},
					});

					if (error)
						throw new Error(error.message ?? "Payment confirmation failed");
				},
			}),
			[stripe, elements],
		);

		return (
			<PaymentElement
				options={{
					layout: "tabs",
				}}
			/>
		);
	},
);

// Outer component: sets up loadStripe + Elements provider
type Props = {
	clientSecret: string;
	publishableKey: string;
};

export const StripePaymentForm = forwardRef<StripeFormHandle, Props>(
	function StripePaymentForm({ clientSecret, publishableKey }, ref) {
		const stripePromise = useMemo(
			() => loadStripe(publishableKey),
			[publishableKey],
		);

		return (
			<Elements stripe={stripePromise} options={{ clientSecret }}>
				<StripeInnerForm ref={ref} />
			</Elements>
		);
	},
);
