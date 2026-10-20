package com.example.tool;

// Runnable, though the file name is neither *Application.java nor Main.java.
public class Launcher {
  public static void main(String... args) {
    System.out.println(args.length);
  }

  // Near misses: not static, and not void, so neither is an entry point.
  public void main(String[] args) {}

  static class Exit {
    public static int main(String[] args) {
      return 0;
    }
  }
}
