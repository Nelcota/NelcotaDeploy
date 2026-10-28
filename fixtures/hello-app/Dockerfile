# Minimal app used by the deploy integration test.
FROM python:3.13-alpine
WORKDIR /srv
COPY site/ .
ARG GREETING=hello
RUN echo "build greeting: ${GREETING}"
EXPOSE 8000
CMD ["python", "-u", "-m", "http.server", "8000"]
