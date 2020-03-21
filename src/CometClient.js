/**
 * Создание сервиса для работы с comet-сервером
 */
import PollingCometClient from './PollingCometClient'
import WebSocketCometClient from './WebSocketsCometClient'

//получение правильного урл по типу подключения
const getTransportUrl = (transport, url) => {
	if (url.indexOf("http://") >= 0 || url.indexOf("https://") >= 0
		|| url.indexOf("ws://") >= 0 || url.indexOf("wss://") >= 0)
		return url;

	let siteProtocol = window.document.location.protocol;
	let host = window.document.location.host;
	let protocol = siteProtocol;
	if (transport == 'webSockets')
		protocol = siteProtocol === "https:" ? "wss:" : "ws:";

	if (url.indexOf('//') >= 0) {
		return protocol + url;
	} else {
		return protocol + "//" + host + url
	}
}

export default class CometClient {
    cometInstance = null;
    instanceId = null;
    options = {};
    transports = null;
    logger = {
        logEnabled: false,
		configurate: (options)=> {
			this.logEnabled = (options && options.logging ? true : false);
		},
		log: (...args)=> {
			if (this.logEnabled) {
				// eslint-disable-next-line no-console
				console.log(...args);
			}
		}};
    publisher = () => {
    }; //noop

    /**
     *
     * @param options - {
    "logging": true,
    "transports": {
      "longPolling": {
        "url": "/api/comet/messages",
        "retryCount": 3
      },
      "webSockets": {
        "url": "/api/comet/ws",
        "retryCount": 3
      }
    },
    "timeoutReconnect": 3000
  },
     * @param publisher - колбэк который будет вызываться при получении события
     * @param transports - из коробки доступны Веб-сокет и лонг-пулинг
     * @param httpClient - утилита для отправки запросов, должен возвращать promise, принимает в качестве аргументов
     * объект с полями {method:'', url: '', header:{}, data:{}}
     */
    constructor(options, publisher, httpClient,
                transports = [WebSocketCometClient, PollingCometClient]) {
        this.instanceId = new Date().getTime();
        this.options = options;
        this.transports = transports;
        this.logger.configurate(options);
        this.publisher = publisher;
        this.httpClient = httpClient;
    }

    /**
     * Начать слушать сервер
     * @param interceptors - массив функций-фильтров если не нужно обрабатывать какие то события
     * @param xToken - Нужен при обращении к апи по лонг-пулингу
     */
    start(interceptors, {xToken}) {

        if (this.cometInstance) {
            this.cometInstance.stop();
            this.cometInstance = null;
        }

        const connect = (excludeTransport) => {
            let inst = null;

            let i = 0;
            while (inst == null && i < this.transports.length) {
                var transportInstance = new this.transports[i]({httpClient: this.httpClient});
                let name = transportInstance.clientName;

                if (transportInstance &&
                    name != excludeTransport &&
                    transportInstance.available()) {

                    let url = getTransportUrl(name, this.options.transports[name].url);
                    inst = transportInstance;
                    inst.setParams({
                        xToken: xToken,
                        url: url,
                        timeoutReconnect: this.options.timeoutReconnect,
                        retryCount: this.options.transports[name].retryCount,
                        instanceId: this.instanceId
                    });
                }
                i++;
            }
            if (inst) {
                this.cometInstance = inst;
                this.cometInstance.start({
                    onConnectComplete: onReceiveMessage,
                    onErrorConnect: onError,
                    onRetryFail: onRetryFail
                });
            }
        };

        const onReceiveMessage = (response) => {
            let events = response.data;
            if (events && events.length > 0) {
                events.forEach((event) => {
                    let handlerName = event.NotificationName;
                    let data = event.Data;
                    //@if DEBUG
                    this.logger.log("IO event handled: ", handlerName, data);
                    if (!handlerName) {
                        console.debug(`[${new Date()}] Comet: no name event`);
                        return;
                    }
                    // @endif

                    checkInterceptors(interceptors, handlerName, event)
                        .then(_ => this.publisher(handlerName, data));
                });
            }
        };

        const checkInterceptors = (interceptors, handlerName, event) => {
            let prom = new Promise((resolve) => resolve(true));
            if (interceptors) {
                interceptors.forEach(interceptor => {
                    prom = prom.then(() => {
                        if (!interceptor(handlerName, event))
                            return new Promise((_, reject) => reject(true));
                        return true;
                    })
                });
            }
            return prom;
        };

        const onError = (exception) => {
            // eslint-disable-next-line no-console
            console.debug(`[${new Date()}] Comet: error`, exception);
        };

        const onRetryFail = (failedTransport) => {
            connect(failedTransport);
        };

        connect();
    }

    /**
     * Остановить прослушку
     */
    stop() {
        if (this.cometInstance)
            this.cometInstance.stop();
    }
}