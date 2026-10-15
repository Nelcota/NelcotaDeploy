package maintenance

import "syscall"

const sysNoFollow = syscall.O_NOFOLLOW | syscall.O_NONBLOCK
const sysDirectory = syscall.O_DIRECTORY
