import multer from "multer";
import { FILE_TYPES, MAX_FILE_BYTES } from "../services/file.service.js";
import { AppError, badRequest, tooMany } from "../utils/appError.js";

const multerSingleFile = multer({
  storage: multer.memoryStorage(),
  // File names arrive as UTF-8 (Telugu, Hindi…); multer assumes Latin-1 otherwise.
  defParamCharset: "utf8",
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 10, fieldSize: 8 * 1024 },
  fileFilter: (req, file, cb) => {
    if (FILE_TYPES[file.mimetype]) return cb(null, true);
    cb(badRequest("That file type isn't allowed. Upload a PDF, Word, PowerPoint, PNG, JPG or text file."));
  }
}).single("file");

// A broken or cut-off upload is the sender's problem (400), not a server error.
function parseSingleFile(req, res, next) {
  multerSingleFile(req, res, (error) => {
    if (!error || error instanceof AppError || error instanceof multer.MulterError) return next(error);
    next(badRequest("That upload didn't come through properly. Try again."));
  });
}

/*
 * One upload at a time per person (this process), so nobody can hold many
 * large files in memory at once. Released when the response ends or the
 * connection drops.
 */
const uploading = new Set();

export function uploadSingleFile(req, res, next) {
  const userId = req.user?.id;
  if (!userId || !req.is("multipart/form-data")) return parseSingleFile(req, res, next);
  if (uploading.has(userId)) return next(tooMany("Wait for your other upload to finish"));

  uploading.add(userId);
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      uploading.delete(userId);
    }
  };
  res.on("finish", release);
  res.on("close", release);
  parseSingleFile(req, res, next);
}
