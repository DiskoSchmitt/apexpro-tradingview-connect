// buildOrderParams.ts
import ApexproConnector from './client';
import config = require('config');
import { AlertObject } from '../../types';
import 'dotenv/config';
import { getDecimalPointLength } from '../../helper';
import { CreateOrderOptionsObject, generateRandomClientId, OrderType } from "apexpro-connector-node";
import { Market } from "apexpro-connector-node/lib/apexpro/interface";
import { BigNumber } from 'bignumber.js';

export const apexproBuildOrderParams = async (alertMessage: AlertObject) => {
    // Initialize the connector
    const connector = await ApexproConnector.build();

    // Extract the market and dynamically set it for BTC-USDC trades
    let market = alertMessage.market.endsWith("USD") ? alertMessage.market.replace("USD", "USDC") : alertMessage.market;

    // Fetch market data
    const marketsData = await connector.GetSymbolData(market);
    if (!marketsData) {
        console.log('Market data error, symbol=' + market);
        throw new Error('Market data error, symbol=' + market);
    }

    // Extract and log ticker data
    const tickerData = await connector.client.publicApi.tickers(marketsData.crossSymbolName);
    if (tickerData.length == 0) {
        console.error('Ticker data error, symbol=' + marketsData.crossSymbolName);
        throw new Error('Ticker data error, symbol=' + marketsData.crossSymbolName);
    }

    // Determine the order side based on the alert message
    const orderSide = alertMessage.order === 'buy' ? "BUY" : "SELL";

    // Fetch account details to get the available balance
    const accountDetails = await connector.getAccountDetails(); // Placeholder; use actual implementation
    const poolAvailableAmount = new BigNumber(accountDetails.poolAvailableAmount); // Assuming this is how you access the available balance

    // Calculate order size based on marginPercentage from the alertMessage
    const marginPercentage = alertMessage.marginPercentage ? new BigNumber(alertMessage.marginPercentage).div(100) : new BigNumber(1); // Default to 100% if not specified
    let orderSize = poolAvailableAmount.multipliedBy(marginPercentage);

    // Adjust orderSize based on market's stepSize
    const stepSize = new BigNumber(marketsData.stepSize);
    let orderSizeStr = orderSize.toFixed(getDecimalPointLength(stepSize.toNumber()), BigNumber.ROUND_DOWN);

    // Prepare other order parameters
    const latestPrice = new BigNumber(tickerData.at(0).oraclePrice);
    const tickSize = new BigNumber(marketsData.tickSize);
    const minPrice = orderSide === "BUY" ? latestPrice.multipliedBy(new BigNumber(1).plus(0.05)) : latestPrice.multipliedBy(new BigNumber(1).minus(0.05));
    const price = minPrice.minus(minPrice.mod(tickSize)).toFixed();

    // Calculate fee if applicable
    const fee = new BigNumber(config.get('Apexpro.User.limitFee')).multipliedBy(price).multipliedBy(orderSizeStr);
    const currency_info = connector.symbols.currency.find(item => item.id === marketsData.settleCurrencyId);
    const limitFee = fee.toFixed(currency_info.starkExResolution.length - 1, BigNumber.ROUND_UP);

    // Construct the API order object
    const apiOrder: CreateOrderOptionsObject = {
        limitFee: limitFee.toString(),
        price: price,
        reduceOnly: false,
        side: orderSide,
        size: orderSizeStr,
        symbol: <Market>market,
        timeInForce: 'FILL_OR_KILL',
        type: OrderType.MARKET,
        clientOrderId: generateRandomClientId(),
        positionId: connector.positionID,
        trailingPercent: '',
        triggerPrice: '',
    };

    console.log('API Order for Apex:', apiOrder);
    return apiOrder;
};
