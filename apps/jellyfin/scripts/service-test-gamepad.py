import array
import fcntl
import glob
import json
import os
import struct
import sys
import time

devices = []
try:
    for index in range(2):
        fd = os.open('/dev/uinput', os.O_WRONLY | os.O_NONBLOCK)
        devices.append(fd)
        fcntl.ioctl(fd, 0x40045564, 1)
        for key in [304, 305, 307, 308, 310, 311, 314, 315, 316, 317, 318]:
            fcntl.ioctl(fd, 0x40045565, key)
        fcntl.ioctl(fd, 0x40045564, 3)
        maximum, minimum = [0] * 64, [0] * 64
        for axis in [0, 1, 2, 3, 4, 5, 16, 17]:
            fcntl.ioctl(fd, 0x40045567, axis)
            maximum[axis] = 1 if axis >= 16 else 255 if axis in [2, 5] else 32767
            minimum[axis] = -1 if axis >= 16 else 0 if axis in [2, 5] else -32768
        name = f'ValveFin focus test {index}'
        os.write(fd, struct.pack('80sHHHHI', name.encode(), 3, 0x045e, 0x028e, 0x0114, 0) + array.array('i', maximum + minimum + [0] * 128).tobytes())
        fcntl.ioctl(fd, 0x5501)
    paths = []
    for attempt in range(100):
        paths = []
        for name in glob.glob('/sys/devices/virtual/input/input*/name'):
            with open(name) as source:
                if source.read().strip().startswith('ValveFin focus test '):
                    for node in glob.glob(os.path.dirname(name) + '/event*') + glob.glob(os.path.dirname(name) + '/js*'):
                        target = '/dev/input/' + os.path.basename(node)
                        if os.path.exists(target):
                            os.chmod(target, 0o644)
                            paths.append(target)
        if len(paths) >= 4:
            break
        time.sleep(.05)
    print(json.dumps({'ready': True, 'nodes': paths}), flush=True)
    for line in sys.stdin:
        command = json.loads(line)
        if command.get('quit'):
            break
        for index in command.get('pads', [0]):
            os.write(devices[index], struct.pack('llHHi', 0, 0, command.get('type', 1), command['key'], command['value']))
            os.write(devices[index], struct.pack('llHHi', 0, 0, 0, 0, 0))
        print(json.dumps({'sent': command}), flush=True)
finally:
    for fd in devices:
        fcntl.ioctl(fd, 0x5502)
        os.close(fd)
