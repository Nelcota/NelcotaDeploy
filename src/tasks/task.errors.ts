/** Thrown when a cron expression is malformed or never fires. */
export class InvalidScheduleError extends Error {
  constructor(schedule: string, reason: string) {
    super(`Invalid schedule ${JSON.stringify(schedule)}: ${reason}`);
    this.name = "InvalidScheduleError";
  }
}

/** Thrown when a task id does not belong to the project. */
export class TaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`Task ${taskId} not found`);
    this.name = "TaskNotFoundError";
  }
}

/** Thrown when a task name is already used in the project. */
export class TaskNameTakenError extends Error {
  constructor(name: string) {
    super(`Task name ${name} is already used in this project`);
    this.name = "TaskNameTakenError";
  }
}
