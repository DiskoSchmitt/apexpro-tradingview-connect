import ApexproConnector from './client';
import config = require('config');
import { AlertObject } from '../../types';
import 'dotenv/config';
import { getDecimalPointLength, getStrategiesDB } from '../../helper';
import { CreateOrderOptionsObject, generateRandomClientId, OrderType } from "apexpro-connector-node";
import { Market } from "apexpro-connector-node/lib/apexpro/interface";
import { BigNumber } from 'bignumber.js';

export const apexproBuildOrderParams = async (alertMessage: AlertObject) => {
    const [db, rootData] = getStrategiesDB();

    const connector = await ApexproConnector.build();

    let market = alertMessage.market.endsWith("USD") ? alertMessage.market.replace("USD", "USDC") : alertMessage.market;

    const marketsData = await connector.GetSymbolData(market);
    if (!marketsData) {
        console.log('Market data error, symbol=' + market);
        throw new Error('Market data error, symbol=' + market);
    }
    console.log('Market Data', marketsData);

    const tickerData = await connector.client.publicApi.tickers(marketsData.crossSymbolName);
    if (tickerData.length == 0) {
        console.error('Ticker data is error, symbol=' + marketsData.crossSymbolName);
        throw new Error('Ticker data error, symbol=' + marketsData.crossSymbolName);
    }
    console.log('Ticker Data', tickerData);

    const orderSide = alertMessage.order === 'buy' ? "BUY" : "SELL";

    // Fetching the actual available balance from the account details
    const accountBalance = await connector.totalEquityValue(); // Ensure this method exists and correctly fetches the balance
    const availableBalance = new BigNumber(accountBalance.availableBalance); // Use the fetched available balance

    const tradeMarginPercentage = new BigNumber(process.env.TRADE_MARGIN_PERCENTAGE || '100').div(100);
    let orderSize = availableBalance.multipliedBy(tradeMarginPercentage);

    const stepSize = new BigNumber(marketsData.stepSize);
    const orderSizeStr = orderSize.div(stepSize).dp(0, BigNumber.ROUND_DOWN).multipliedBy(stepSize).toFixed();

    const latestPrice = new BigNumber(tickerData.at(0).oraclePrice);
    const tickSize = new BigNumber(marketsData.tickSize);

    const slippagePercentage = new BigNumber(0.05);
    const minPrice = orderSide === "BUY"
        ? latestPrice.multipliedBy(new BigNumber(1).plus(slippagePercentage))
        : latestPrice.multipliedBy(new BigNumber(1).minus(slippagePercentage));
    const price = minPrice.minus(minPrice.mod(tickSize)).toFixed();

    const fee = new BigNumber(config.get('Apexpro.User.limitFee')).multipliedBy(price).multipliedBy(orderSizeStr);
    console.log('Fee:', fee.toString());

    const currency_info = connector.symbols.currency.find(item => item.id === marketsData.settleCurrencyId);
    const limitFee = fee.toFixed(currency_info.starkExResolution.length - 1, BigNumber.ROUND_UP);
    console.log('Limit Fee:', limitFee.toString());

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
