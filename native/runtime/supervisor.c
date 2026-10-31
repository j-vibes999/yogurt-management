#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#ifndef YM_HEARTBEAT_MS
#define YM_HEARTBEAT_MS 15000
#endif
#ifndef YM_TERM_GRACE_MS
#define YM_TERM_GRACE_MS 3500
#endif
#define QUEUE_SIZE 131072
#define EVENT_SIZE 4096

static volatile sig_atomic_t requested_stop = 0;
static void on_signal(int number) { (void)number; requested_stop = 1; }
static int64_t now_ms(void) {
  struct timespec value;
  if (clock_gettime(CLOCK_MONOTONIC, &value) != 0) _exit(1);
  return (int64_t)value.tv_sec * 1000 + value.tv_nsec / 1000000;
}
static void nonblocking(int descriptor) {
  int flags = fcntl(descriptor, F_GETFL, 0);
  if (flags >= 0) (void)fcntl(descriptor, F_SETFL, flags | O_NONBLOCK);
}
static void event(const char *type, const char *code) {
  if (code) (void)printf("{\"version\":1,\"type\":\"%s\",\"code\":\"%s\"}\n", type, code);
  else (void)printf("{\"version\":1,\"type\":\"%s\"}\n", type);
  (void)fflush(stdout);
}
static int group_alive(pid_t child) { return kill(-child, 0) == 0 || errno == EPERM; }

/* Only canonical events leave this process. Raw Next/Prisma diagnostics never do. */
static void child_event(char *line, int *ready, int *failed) {
  if (!strstr(line, "\"version\":1,") && !strstr(line, "\"version\":1}")) return;
  if (strstr(line, "\"type\":\"ready\"") && !*ready && !*failed) { *ready = 1; event("ready", NULL); return; }
  if (!strstr(line, "\"type\":\"failed\"") || *failed) return;
  *failed = 1;
  const char *codes[] = { "PORT_BUSY", "CONFIGURATION", "START_FAILED", "CONTROL_PROTOCOL", "HEARTBEAT_TIMEOUT", NULL };
  for (int i = 0; codes[i]; i++) {
    char match[80];
    (void)snprintf(match, sizeof(match), "\"code\":\"%s\"", codes[i]);
    if (strstr(line, match)) { event("failed", codes[i]); return; }
  }
  event("failed", "START_FAILED");
}

int main(int argc, char **argv) {
  if (argc != 3 || argv[1][0] != '/' || argv[2][0] != '/') { event("failed", "CONFIGURATION"); return 1; }
  struct sigaction action;
  memset(&action, 0, sizeof(action));
  action.sa_handler = on_signal;
  (void)sigaction(SIGTERM, &action, NULL);
  (void)sigaction(SIGINT, &action, NULL);
  (void)signal(SIGPIPE, SIG_IGN);
  const pid_t owner = getppid();
  int input[2], output[2], errors[2];
  if (pipe(input) || pipe(output) || pipe(errors)) { event("failed", "SPAWN_FAILED"); return 1; }
  const pid_t child = fork();
  if (child < 0) { event("failed", "SPAWN_FAILED"); return 1; }
  if (child == 0) {
    (void)setpgid(0, 0);
    (void)signal(SIGTERM, SIG_DFL); (void)signal(SIGINT, SIG_DFL); (void)signal(SIGPIPE, SIG_DFL);
    (void)dup2(input[0], STDIN_FILENO); (void)dup2(output[1], STDOUT_FILENO); (void)dup2(errors[1], STDERR_FILENO);
    close(input[0]); close(input[1]); close(output[0]); close(output[1]); close(errors[0]); close(errors[1]);
    execl(argv[1], argv[1], argv[2], (char *)NULL);
    _exit(127);
  }
  (void)setpgid(child, child);
  close(input[0]); close(output[1]); close(errors[1]);
  nonblocking(STDIN_FILENO); nonblocking(input[1]); nonblocking(output[0]); nonblocking(errors[0]);
  char queue[QUEUE_SIZE], line[EVENT_SIZE];
  size_t queued = 0, used = 0;
  int overflow = 0, stopping = 0, reaped = 0, status = 0, ready = 0, failed = 0, unexpected_exit = 0;
  int64_t last_input = now_ms(), stop_at = 0;
  while (1) {
    const int64_t now = now_ms();
    if (failed) stopping = 1;
    if (!stopping && (requested_stop || getppid() != owner || owner <= 1)) stopping = 1;
    if (!stopping && now - last_input >= YM_HEARTBEAT_MS) { event("failed", "HEARTBEAT_TIMEOUT"); stopping = 1; }
    if (!reaped && waitpid(child, &status, WNOHANG) == child) {
      reaped = 1;
      if (!stopping && (!WIFEXITED(status) || WEXITSTATUS(status) != 0)) unexpected_exit = 1;
      stopping = 1;
    }
    if (stopping && !stop_at) {
      stop_at = now + YM_TERM_GRACE_MS;
      close(input[1]); input[1] = -1;
      (void)kill(-child, SIGTERM);
    }
    int finished = stopping && !group_alive(child);
    if (stopping && !finished && now >= stop_at) {
      (void)kill(-child, SIGKILL);
      if (!reaped) { while (waitpid(child, &status, 0) < 0 && errno == EINTR) {} reaped = 1; }
      finished = 1;
    }
    struct pollfd descriptors[4] = {
      { stopping ? -1 : STDIN_FILENO, POLLIN | POLLHUP, 0 },
      { input[1], queued ? POLLOUT : 0, 0 },
      { output[0], POLLIN | POLLHUP, 0 },
      { errors[0], POLLIN | POLLHUP, 0 },
    };
    (void)poll(descriptors, 4, finished ? 0 : 50);
    if (!stopping && descriptors[0].revents & (POLLIN | POLLHUP)) {
      char bytes[8192];
      const ssize_t count = read(STDIN_FILENO, bytes, sizeof(bytes));
      if (count > 0) {
        last_input = now_ms();
        if ((size_t)count > QUEUE_SIZE - queued) { event("failed", "CONTROL_PROTOCOL"); stopping = 1; }
        else { memcpy(queue + queued, bytes, (size_t)count); queued += (size_t)count; }
      } else if (count == 0 || (errno != EAGAIN && errno != EINTR)) stopping = 1;
    }
    if (!stopping && queued && input[1] >= 0 && descriptors[1].revents & POLLOUT) {
      const ssize_t count = write(input[1], queue, queued);
      if (count > 0) { queued -= (size_t)count; memmove(queue, queue + count, queued); }
      else if (count < 0 && errno != EAGAIN && errno != EINTR) stopping = 1;
    }
    for (int index = 2; index < 4; index++) {
      if (!(descriptors[index].revents & (POLLIN | POLLHUP))) continue;
      char bytes[8192];
      ssize_t count;
      /* Bound diagnostics work so a noisy child cannot starve the watchdog. */
      for (int batch = 0; batch < 16 && (count = read(descriptors[index].fd, bytes, sizeof(bytes))) > 0; batch++) {
        if (index == 3) continue;
        for (ssize_t offset = 0; offset < count; offset++) {
          if (bytes[offset] == '\n') {
            if (!overflow) { line[used] = '\0'; child_event(line, &ready, &failed); }
            used = 0; overflow = 0;
          } else if (used + 1 < EVENT_SIZE && !overflow) line[used++] = bytes[offset];
          else overflow = 1;
        }
      }
    }
    if (finished) break;
  }
  if (!reaped) { (void)kill(-child, SIGKILL); while (waitpid(child, &status, 0) < 0 && errno == EINTR) {} }
  /* Clear the bootstrap bytes before this short-lived supervisor exits. */
  volatile char *clear = queue;
  for (size_t index = 0; index < sizeof(queue); index++) clear[index] = 0;
  close(output[0]); close(errors[0]);
  if (unexpected_exit && !failed) event("failed", "CHILD_EXIT");
  event("shutdown", NULL);
  return 0;
}
