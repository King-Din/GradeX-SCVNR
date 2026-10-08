import express from 'express';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { requireRole } from '../middleware/requireRole.js';
import upload from '../middleware/upload.js';

import {
    submitTask,
    getMySubmissions,
    getSubmissionById,
} from '../controllers/submission.controller.js';

const router = express.Router();

router.post(
    '/submissions',
    authenticateUser,
    requireRole('VOLUNTEER'),
    upload.single('file'),
    submitTask
);

// /my must come before /:id
router.get(
    '/submissions/my',
    authenticateUser,
    requireRole('VOLUNTEER'),
    getMySubmissions
);

router.get(
    '/submissions/:id',
    authenticateUser,
    getSubmissionById
);

export default router;