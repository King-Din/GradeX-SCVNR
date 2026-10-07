export function success(res, statusCode, data = {}) {
  return res.status(statusCode).json({
    success: true,
    ...data
  });
}

export function failure(res, statusCode, code, message, details) {
  const body = {
    success: false,
    error: {
      code,
      message
    }
  };

  if (details !== undefined) {
    body.error.details = details;
  }

  return res.status(statusCode).json(body);
}
