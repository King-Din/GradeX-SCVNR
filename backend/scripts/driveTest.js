require('dotenv').config();
const { uploadToDrive } = require('../src/services/drive.service');

(async () => {
    const result = await uploadToDrive({
        buffer: Buffer.from('hello from B4'),
        mimeType: 'text/plain',
        fileName: 'b4-test.txt',
    });
    console.log(result);
})().catch((e) => console.error(e.response?.data || e.message));