// Embedded Payment Element upgrade page (spec 022, replacing spec 016's
// Checkout-redirect flow). Client Component: Stripe.js/Payment Element
// requires browser interactivity, same documented exception class as the
// login/signup pages. On mount, POSTs /api/users/upgrade (requires the
// session cookie already be set), receives { clientSecret }, and renders
// Stripe's Payment Element inside a confirm-payment form — the browser
// never navigates to a stripe.com-hosted page. This page's own redirect on
// success is driven by payment confirmation, never by any assumption about
// users.tier — that column is exclusively the webhook handler's
// responsibility (unchanged invariant from spec 016, re-affirmed here).
'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { getStripeJsPromise } from '@/lib/stripeClient';

interface UpgradeIntentResponse {
  clientSecret?: string;
  authenticated?: boolean;
}

function ConfirmPaymentForm({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();
  const stripe = useStripe();
  const elements = useElements();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!stripe || !elements) return;

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const returnUrl = new URL('/account/upgrade', window.location.origin);
      returnUrl.searchParams.set('callbackUrl', callbackUrl);

      // Payment is confirmed entirely client-side via Stripe.js against the
      // server-issued clientSecret — this app's own server never sees card
      // data and never itself confirms payment (spec 022 Design Pattern).
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl.toString() },
        redirect: 'if_required',
      });

      if (error) {
        // Inline error, no redirect — the same clientSecret/PaymentIntent
        // can be retried without a fresh POST /api/users/upgrade call
        // (spec 022 Edge Cases).
        setErrorMessage(error.message ?? 'Payment failed. Please try again.');
        return;
      }

      if (paymentIntent && paymentIntent.status === 'succeeded') {
        // Confirmed success — redirect happens on payment confirmation,
        // never on any assumption about users.tier (the webhook is still
        // the only writer of that column). A brief "processing" state
        // covers the window before the webhook lands.
        setIsProcessing(true);
        router.push(callbackUrl);
        return;
      }

      // Any other non-error status (e.g. requires_action handled via
      // redirect) — Stripe.js itself navigates when redirect isn't
      // 'if_required'-eligible; nothing further to do here.
    } catch {
      setErrorMessage('Payment failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isProcessing) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-slate-500 dark:text-slate-400">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600 dark:border-slate-600 dark:border-t-slate-300" />
        Processing your upgrade…
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <PaymentElement />

      {errorMessage && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {errorMessage}
        </p>
      )}

      <button
        type="submit"
        disabled={!stripe || !elements || isSubmitting}
        className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {isSubmitting ? 'Confirming…' : 'Confirm upgrade'}
      </button>
    </form>
  );
}

function UpgradePageContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isCurrentRequest = true;

    fetch('/api/users/upgrade', { method: 'POST', credentials: 'include' })
      .then(async (response) => {
        if (response.status === 401) {
          return { clientSecret: null, signedOut: true, error: null };
        }
        if (!response.ok) {
          return { clientSecret: null, signedOut: false, error: 'Failed to start checkout. Please try again.' };
        }
        const payload = (await response.json()) as UpgradeIntentResponse;
        if (!payload.clientSecret) {
          return { clientSecret: null, signedOut: false, error: 'Failed to start checkout. Please try again.' };
        }
        return { clientSecret: payload.clientSecret, signedOut: false, error: null };
      })
      .then((result) => {
        if (!isCurrentRequest) return;
        setClientSecret(result.clientSecret);
        setSignedOut(result.signedOut);
        setError(result.error);
        setLoading(false);
      })
      .catch(() => {
        if (!isCurrentRequest) return;
        setError('Failed to start checkout. Please try again.');
        setLoading(false);
      });

    return () => {
      isCurrentRequest = false;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <h1 className="mb-6 text-center text-2xl font-semibold text-slate-900 dark:text-slate-100">
        Upgrade to Premium
      </h1>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500 dark:text-slate-400">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600 dark:border-slate-600 dark:border-t-slate-300" />
          Loading…
        </div>
      )}

      {!loading && signedOut && (
        <p className="text-center text-sm text-slate-600 dark:text-slate-400">
          Please{' '}
          <Link href={`/login?callbackUrl=${encodeURIComponent(`/account/upgrade?callbackUrl=${callbackUrl}`)}`} className="font-semibold text-blue-600 hover:underline dark:text-blue-400">
            sign in
          </Link>{' '}
          first.
        </p>
      )}

      {!loading && !signedOut && error && (
        <p role="alert" className="text-center text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {!loading && !signedOut && !error && clientSecret && (
        <Elements stripe={getStripeJsPromise()} options={{ clientSecret }}>
          <ConfirmPaymentForm callbackUrl={callbackUrl} />
        </Elements>
      )}
    </main>
  );
}

export default function UpgradePage() {
  return (
    <Suspense
      fallback={<p className="text-center text-sm text-slate-500 dark:text-slate-400">Loading…</p>}
    >
      <UpgradePageContent />
    </Suspense>
  );
}
