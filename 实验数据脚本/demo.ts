import 'dotenv/config'; // 通过 dotenv/config 自动加载 .env 文件中的环境变量
import {
  AndroidAgent,
  AndroidDevice,
  getConnectedDevices,
} from '@midscene/android';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
Promise.resolve(
  (async () => {
    const devices = await getConnectedDevices();
    const device = new AndroidDevice(devices[0].udid);

    const agent = new AndroidAgent(device, {
      aiActionContext:
        'If any location, permission, user agreement, etc. popup, click agree. If login page pops up, close it.',
    });
    await device.connect();

    await agent.aiAct('open browser and navigate to ebay.com');
    await sleep(5000);
    await agent.aiAct('type "Headphones" in search box, hit Enter');
    await agent.aiWaitFor('There is at least one headphone product');

    const items = await agent.aiQuery(
      '{itemTitle: string, price: Number}[], find item in list and corresponding price',
    );
    console.log('headphones in stock', items);

    await agent.aiAssert('There is a category filter on the left');
  })(),
);