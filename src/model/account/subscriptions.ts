import * as _ from 'lodash';
import { reportError } from '../../errors';
import { delay, doWhile } from '../../util/promise';

export interface SubscriptionPlan {
    id: number;
    name: string;
    prices?: {
        currency: string;
        monthly: string;
        total: string;
    };
}

export const SubscriptionPlans = {
    'pro-monthly': { id: 550380, name: 'Pro (monthly)' } as SubscriptionPlan,
    'pro-annual': { id: 550382, name: 'Pro (annual)' } as SubscriptionPlan,
    'pro-perpetual': { id: 599788, name: 'Pro (perpetual)' } as SubscriptionPlan,
    'team-monthly': { id: 550789, name: 'Team (monthly)' } as SubscriptionPlan,
    'team-annual': { id: 550788, name: 'Team (annual)' } as SubscriptionPlan,
};

async function loadPlanPrices() {
    Object.values(SubscriptionPlans).forEach((plan) => {
        const currency = 'X';
        const totalPrice = 0;
        const monthlyPrice = 0;

        plan.prices = {
            currency: currency,
            total: formatPrice(currency, totalPrice),
            monthly: formatPrice(currency, monthlyPrice)
        };
    });
}

// Async load all plan prices, repeatedly, until it works
doWhile(
    // Do: load the prices, with a timeout
    () => Promise.race([
        loadPlanPrices().catch(reportError),
        delay(5000) // 5s timeout
    ]).then(() => delay(1000)), // Limit the frequency

    // While: if any subs didn't successfully get data, try again:
    () => _.some(SubscriptionPlans, (plan) => !plan.prices),
);


function formatPrice(currency: string, price: number) {
    return Number(price).toLocaleString(undefined, {
        style:"currency",
        currency: currency,
        minimumFractionDigits: _.round(price) === price ? 0 : 2,
        maximumFractionDigits: 2
    })
}

export type SubscriptionPlanCode = keyof typeof SubscriptionPlans;

export const getSubscriptionPlanCode = (id: number | undefined) =>
    _.findKey(SubscriptionPlans, { id: id }) as SubscriptionPlanCode | undefined;

export const openCheckout = async (email: string, planCode: SubscriptionPlanCode) => {
    window.open(
        `https://pay.paddle.com/checkout/${
            SubscriptionPlans[planCode].id
        }?guest_email=${
            encodeURIComponent(email)
        }&referring_domain=app.httptoolkit.tech`,
        '_blank'
    );
}
