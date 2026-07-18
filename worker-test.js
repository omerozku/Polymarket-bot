// Test - Worker çalışıyor mu?
export default {
  async fetch(request) {
    return new Response("Worker OK", { status: 200 });
  }
};
