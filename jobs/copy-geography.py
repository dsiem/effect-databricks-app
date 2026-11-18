import sys
from shutil import copyfile

source, destination = sys.argv[1:]
copyfile(source, destination)
