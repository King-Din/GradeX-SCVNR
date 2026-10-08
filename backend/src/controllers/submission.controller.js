import crypto from 'crypto';
import { success, fail } from '../utils/response.js';
import { uploadToDrive } from '../services/drive.service.js';
import {
    getTasks,
    getParticipations,
    updateParticipation,
    getSubmissions,
    createSubmission,
} from '../services/sheets.service.js';

// Stored file extension comes from the file type, never from the user's file name
const EXTENSIONS = {
    'application/pdf': '.pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'image/png': '.png',
    'image/jpeg': '.jpg',
};
const ALREADY_SUBMITTED = ['SUBMITTED', 'UNDER_REVIEW', 'COMPLETED'];

// POST /api/submissions  (form-data: taskId + file)
async function submitTask(req, res) {
    try {
        const user = req.user;

        // 1. Only volunteers can submit
        if (user.role !== 'VOLUNTEER') {
            return fail(res, 'Only volunteers can submit', 403);
        }

        // 2. taskId must look like T001
        const taskId = req.body && req.body.taskId;
        if (!taskId || !/^T\d{3,}$/.test(taskId)) {
            return fail(res, 'Invalid task id', 400);
        }

        // 3. A file must be attached
        if (!req.file) {
            return fail(res, 'No file uploaded', 400);
        }

        // 4. The task must exist
        const tasks = await getTasks();
        const task = tasks.find((t) => t.id === taskId);
        if (!task) {
            return fail(res, 'Task not found', 404);
        }

        // 5. The volunteer must have chosen this task (identity comes from the login, never the body)
        const participations = await getParticipations();
        const participation = participations.find(
            (p) => p.taskId === taskId && p.volunteerId === req.user.id
        );
        if (!participation) {
            return fail(res, 'You have not chosen this task', 403);
        }

        // 6. The deadline must not have passed
        if (new Date() > new Date(task.deadline)) {
            return fail(res, 'Deadline has passed', 403);
        }

        // 7. One submission per Participation
        if (ALREADY_SUBMITTED.includes(participation.status)) {
            return fail(res, 'You have already submitted this task', 409);
        }

        // 8. All checks passed: upload to Drive with a name we generate
        const extension = EXTENSIONS[req.file.mimetype] || '';
        const storedName = `${participation.id}_${crypto.randomUUID()}${extension}`;
        const { fileId, fileUrl } = await uploadToDrive({
            buffer: req.file.buffer,
            mimeType: req.file.mimetype,
            fileName: storedName,
        });

        // 9. Save the record, then mark the Participation SUBMITTED
        const record = await createSubmission({
            participationId: participation.id,
            taskId,
            volunteerId: req.user.id,
            fileId,
            fileUrl,
            submittedAt: new Date().toISOString(),
        });
        await updateParticipation(participation.id, { status: 'SUBMITTED' });

        return success(res, record, 'Submission uploaded', 201);
    } catch (err) {
        console.error('submitTask error:', err.message);
        return fail(res, 'Server error while submitting', 500);
    }
}

// GET /api/submissions/my
async function getMySubmissions(req, res) {
    try {
        if (req.user.role !== 'VOLUNTEER') {
            return fail(res, 'Only volunteers have personal submissions', 403);
        }
        const submissions = (await getSubmissions()).filter(
            (s) => s.volunteerId === req.user.id
        );
        return success(res, submissions, 'Your submissions', 200);
    } catch (err) {
        console.error('getMySubmissions error:', err.message);
        return fail(res, 'Server error', 500);
    }
}

// GET /api/submissions/:id
async function getSubmissionById(req, res) {
    try {
        const { id } = req.params;
        if (!/^S\d{3,}$/.test(id)) {
            return fail(res, 'Invalid submission id', 400);
        }
        const submissions = await getSubmissions();
        const submission = submissions.find(
            (s) => s.id === id
        );
        const isCoordinator = req.user.role === 'COORDINATOR';
        // 404 (not 403) so we never confirm that someone else's record exists
        if (!submission || (!isCoordinator && submission.volunteerId !== req.user.id)) {
            return fail(res, 'Submission not found', 404);
        }
        return success(res, submission, 'Submission', 200);
    } catch (err) {
        console.error('getSubmissionById error:', err.message);
        return fail(res, 'Server error', 500);
    }
}

export { submitTask, getMySubmissions, getSubmissionById };