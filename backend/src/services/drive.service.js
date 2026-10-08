import { google } from 'googleapis';
import { Readable } from 'stream';

const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
);

auth.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

const drive = google.drive({
    version: 'v3',
    auth
});

async function uploadToDrive({ buffer, mimeType, fileName }) {
    const res = await drive.files.create({
        requestBody: {
            name: fileName,
            parents: [process.env.DRIVE_FOLDER_ID]
        },
        media: {
            mimeType,
            body: Readable.from([buffer])
        },
        fields: 'id, webViewLink',
    });

    return {
        fileId: res.data.id,
        fileUrl: res.data.webViewLink
    };
}

async function deleteFromDrive(fileId) {
    await drive.files.delete({ fileId });
}

export { uploadToDrive, deleteFromDrive };