# FrameLab GPU worker — Python 3.12 + PyTorch.
# CUDA is reported by torch.cuda.is_available() at runtime. Never faked.
FROM python:3.12-slim-bookworm

WORKDIR /worker

ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
COPY requirements.txt /worker/requirements.txt
RUN pip install --no-cache-dir --index-url ${TORCH_INDEX} torch \
    && pip install --no-cache-dir numpy

COPY device.py server.py /worker/

ENV PYTHONUNBUFFERED=1
ENV FRAMELAB_GPU_WORKER_PORT=8090
EXPOSE 8090

CMD ["python3", "server.py", "--host", "0.0.0.0", "--port", "8090"]
