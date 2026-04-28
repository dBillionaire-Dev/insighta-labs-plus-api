import { Request, Response, NextFunction } from "express";

export function requestLogger(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const start: number = Date.now();
    console.log(typeof start);

    res.on("finish", (): void => {
        const duration: number = Date.now() - start;
        console.log(
            `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`
        );
    });

    next();
}