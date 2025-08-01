---

## Features

- This **N-body simulation** of the Solar System is built using **[Three.js](https://threejs.org/)** and **[Emscripten](https://emscripten.org/)**;

- Algorithms written in **C** for speed and compiled using **Emscripten** to be used in JavasScript;

- Graphics programmed using **Three.js** in **JavaScript** to be more immersive and interactve;

- Cached responses from **[JPL Horizons](https://ssd.jpl.nasa.gov/horizons/)** into a JSON using a **[C program](/solar-system-sim/extra/api.c)** for **blazing fast loading times**;

- **Moveable and collapsible UI** to make it as easy to use as possible;

---

## How to use

There are 5 controls in total to learn:

- The simulation method is the algorithm used behind the scene. Euler is the least accurate, Verlet is in the middle, and RK4 is the most accurate, but does not work well for large steps;

- The year refers to the initial year of the simulation, which determines the initial positions of all the planets. Pick a year between 1750 and 2050, and press the set;

- The days/step slider determines the step size, so the amount of time the is being elapsed per step; the bigger the faster and less precise the simulation gets;

- The sec/step slider determines the real time in between steps. The less seconds betweens steps make the animation smoother and run faster, but is more demanding;

- The play/pause button allows to play or pause the entire simulation;

The date in the bottom left is the current date of the simulation in UTC time. The entire controls drawer is draggable from the top bar, and collapsible using the button in the top right of the drawer. 

**Have fun!**

---

## How it started

This initially began as a final project for a Python class in the final session of CEGEP in early 2024. I learned all the physics behind a basic N-body simulation while also learning to program in Python for the first time. In the end, I managed to make a simple **[Python program](https://github.com/Gnardisitor/N-Body-Simulation)** using matplotlib for the UI and a **[notebook using Google Collab](https://colab.research.google.com/drive/1kasJLBFC4tWsAuZxHatzqgjq6hcaKB3x?usp=sharing)**. However, I was never fully satisfied with it since the graphics were very barebones, I could not get a nice animated version and could only get a final graph, and matplotlib could not handle this many points in a 3D graph, crawling to an unusable pace. And the biggest issue was Python itself, since even with using libraries like numpy to accelerate matrix calculations, it still is incredibly slow to compute and uses way too much memory, which made it impossible to ever compute a very large simulation.

After my first year of university, I had learned many things, especially in my Linux, Bash, and C class. I wanted to experiment more with C, and I managed to port all the algorthms from the Python version of the code into C. I was immediately impressed by the speed of this port, with it being able to do very large simulations nearly instantaneously. I knew this was my best way to make my final idea of the project come true. So I continued working on it, making a **[repository on Github](https://github.com/Gnardisitor/N-Body)**, but continued to run into an issue with making a frontend in C. I tried learning OpenGL or other libraries, but had a lot of trouble getting anything to work. I also wanted if possible to make it into a website so that anyone could access it without building an application, so I looked into WebAssembly. It seemed very interesting, and I knew about Three.js for 3D graphics in JavaScript, so I knew that this was possible. After a lot of work, learning Three.js, Emscripten, C, and much more, I managed to make this. While the positions are accurate, the sizes and rotation speeds of the bodies is only done to make the simulation more immersive and are not accurate. The next step for this project is to learn how to convert C arrays into a JavaScript array and make a non-interactive version of the simulation that is built solely for speed and gives a usable JSON file with all the positions. I hope you enjoy this project!

---

## Overview

To simulate the Solar System, a framework for an N-body simulation must be created. This requires creating a class for any celestial object which is being simulated. Each body requires multiple attributes, which are their mass, their position, velocity, and acceleration vector, as well as some array which must keep the history of the previous positions which the body occupied. To be able to simulate, each body requires an initial position and velocity vector for the initial moment in time. An option is using data from JPL Horizons through astroquery.jplhorizons in Python which can interface with the Horizons API for initial positions at any date. Most simulations executed for this report and during development are started on January 1st, 2000, since it has proven to give stable results. To prevent drift and making the graphs unclear, the velocity of the center of mass of the system must be subtracted from the velocity of all bodies. The formula to compute the velocity of the center of mass is:

<p align="center">
${\vec{v}}_{CM}=\frac{\sum_{i}{m_i{\vec{v}}_i}}{\sum_{i}\ m_i}$

This gives us a stable starting point for the simulation. To compute the next steps, acceleration between bodies is required to be computed. The formula for acceleration between two bodies is:

<p align="center">
$\vec{a}=\frac{GM\vec{r}}{r^3}$

In this formula, M is the mass of the other body. To compute the acceleration for a body in the whole system, sum all the accelerations:

<p align="center">
$\vec{a}=\sum_{i}\frac{GM_i{\vec{r}}_i}{r_i^3}$

For the acceleration formulas, $\vec{r}$ is gotten through the formula $\vec{r}={\vec{r}}_2-{\vec{r}}_1$. After getting the acceleration for all the bodies, the new velocities and positions must be computed. To compute these new vectors, there are multiple approximation methods which can be used. The simplest and most common one is the Euler-Cromer method:

<p align="center">
${\vec{v}}_{n+1}={\vec{v}}_n+\left(\vec{a}\cdot h\right)$

<p align="center">
${\vec{x}}_{n+1}={\vec{x}}_n+\left({\vec{v}}_n\cdot h\right)$

```c
void euler(double step) {
	// Compute acceleration for all bodies
	set_acc();

	// Compute new velocity and position
	for (int i = 0; i < SIZE; i++) {
		// Compute new velocity
		bodies[i].vx = bodies[i].vx + (step * bodies[i].ax);
		bodies[i].vy = bodies[i].vy + (step * bodies[i].ay);
		bodies[i].vz = bodies[i].vz + (step * bodies[i].az);

		// Compute new position
		bodies[i].x = bodies[i].x + (step * bodies[i].vx);
		bodies[i].y = bodies[i].y + (step * bodies[i].vy);
		bodies[i].z = bodies[i].z + (step * bodies[i].vz);
	}
}
```

To get the new vectors, the acceleration and velocities are multiplied by the time interval h. This method is very simple and fast to compute but gives inaccurate results when the time interval is too big. Another method which is preferred for N-body simulations is Verlet since it conserves angular momentum. The version which was tested with this program is position Verlet:

<p align="center">
${\vec{x}}_{n+0.5}={\vec{x}}_n+\left(0.5\cdot{\vec{v}}_n\cdot h\right)$

<p align="center">
${\vec{v}}_{n+1}={\vec{v}}_n+\left(\vec{a}\cdot h\right)$

<p align="center">
${\vec{x}}_{n+1}={\vec{x}}_{n+0.5}+\left(0.5\cdot{\vec{v}}_{n+1}\cdot h\right)$

This version computes an extra step by computing the distance at half a time interval h, then computing the new velocity and using it to compute the final position. It will therefore be more accurate than the Newton method, although in testing the differences weren't drastic and barely visible. There is another implementation of Verlet which only requires two lines. However, it produced unstable orbits which were unusable in the program, therefore only the method above is implemented in the code.

```c
void verlet(double step) {
	// Compute position at half-step
	for (int i = 0; i < SIZE; i++) {
		bodies[i].x = bodies[i].x + (0.5 * step * bodies[i].vx);
		bodies[i].y = bodies[i].y + (0.5 * step * bodies[i].vy);
		bodies[i].z = bodies[i].z + (0.5 * step * bodies[i].vz);
	}

	// Compute acceleration for all bodies
	set_acc();

	// Compute next half-step
	for (int i = 0; i < SIZE; i++) {
		// Compute new velocity
		bodies[i].vx = bodies[i].vx + (step * bodies[i].ax);
		bodies[i].vy = bodies[i].vy + (step * bodies[i].ay);
		bodies[i].vz = bodies[i].vz + (step * bodies[i].az);

		// Compute new position at the end of the step
		bodies[i].x = bodies[i].x + (0.5 * step * bodies[i].vx);
		bodies[i].y = bodies[i].y + (0.5 * step * bodies[i].vy);
		bodies[i].z = bodies[i].z + (0.5 * step * bodies[i].vz);
	}
}
```

The final and most used approximation method used in this program is the Runge-Kutta Fourth Order (RK4) method, which approximates the positions at multiple points and computes a weighted average to give the final position and velocity. The RK4 formulas are:

<p align="center">
$k_1=f\left(t_n,\ \ y_n\right)$

<p align="center">
$k_2=f\left(t_n+\frac{h}{2},\ \ y_n+h\frac{k_1}{2}\right)$

<p align="center">
$k_3=f\left(t_n+\frac{h}{2},\ \ y_n+h\frac{k_2}{2}\right)$

<p align="center">
$k_4=f\left(t_n+h,\ \ y_n+hk_3\right)$

<p align="center">
$y_{n+1}=y_n+\frac{h}{6}\left(k_1+{2k}_2+2k_3+k_4\right)$

The Runge-Kutta Fourth Order method functions by taking the derivative multiple times, which is represented by $f(t, y)$, where t is the moment in time when the derivative is to take place, and $y$ is an array containing both the position and velocity vectors. The derivative of $y$ therefore is the velocity and acceleration vectors of the body at that moment in time. $k_1$ is therefore the initial velocity and acceleration vectors of the body. $k_2$ is the velocity and acceleration vectors at half a time interval h with position and velocity vectors derived from the velocity and acceleration vectors derived in $k_1$. RK4 therefore uses the previous approximation for the next one. For all four values of $k$, the new velocity and acceleration at the new point must first begin at the initial position.

```c
void f(double *y) {
	// Assign new position
	for (int i = 0; i < SIZE; i++) {
		bodies[i].x = y[6 * i + 0];
		bodies[i].y = y[6 * i + 1];
		bodies[i].z = y[6 * i + 2];
	}

	// Compute acceleration for all bodies
	set_acc();

	// Set values for tmp bodies (acts as return)
	for (int i = 0; i < SIZE; i++) {
		// Velocity
		tmp[6 * i + 0] = y[6 * i + 3];
		tmp[6 * i + 1] = y[6 * i + 4];
		tmp[6 * i + 2] = y[6 * i + 5];

		// Acceleration
		tmp[6 * i + 3] = bodies[i].ax;
		tmp[6 * i + 4] = bodies[i].ay;
		tmp[6 * i + 5] = bodies[i].az;
	}
}

void rk4(double step) {
	// Set y_1 (current position and velocity)
	for (int i = 0; i < SIZE; i++) {
		y_1[6 * i + 0] = bodies[i].x;
		y_1[6 * i + 1] = bodies[i].y;
		y_1[6 * i + 2] = bodies[i].z;
		y_1[6 * i + 3] = bodies[i].vx;
		y_1[6 * i + 4] = bodies[i].vy;
		y_1[6 * i + 5] = bodies[i].vz;
	}

	// Compute k_1
	for (int i = 0; i < SIZE; i++) {
		f(y_1);
		for (int j = 0; j < 6; j++) k_1[6 * i + j] = tmp[6 * i + j];		
	}

	// Compute k_2
	for (int i = 0; i < SIZE; i++) {
		for (int j = 0; j < 6; j++) y_2[6 * i + j] = y_1[6 * i + j] + (0.5 * step * k_1[6 * i + j]);
	}
	for (int i = 0; i < SIZE; i++) {
		f(y_2);
		for (int j = 0; j < 6; j++) k_2[6 * i + j] = tmp[6 * i + j];
	}

	// Compute k_3
	for (int i = 0; i < SIZE; i++) {
		for (int j = 0; j < 6; j++) y_3[6 * i + j] = y_1[6 * i + j] + (0.5 * step * k_2[6 * i + j]);
	}
	for (int i = 0; i < SIZE; i++) {
		f(y_3);
		for (int j = 0; j < 6; j++) k_3[6 * i + j] = tmp[6 * i + j];
	}

	// Compute k_4
	for (int i = 0; i < SIZE; i++) {
		for (int j = 0; j < 6; j++) y_4[6 * i + j] = y_1[6 * i + j] + (step * k_3[6 * i + j]);
	}
	for (int i = 0; i < SIZE; i++) {
		f(y_4);
		for (int j = 0; j < 6; j++) k_4[6 * i + j] = tmp[6 * i + j];
	}

	// Compute weighted average
	double avg;
	for (int i = 0; i < SIZE; i++) {
		for (int j = 0; j < 6; j++) {
			avg = (step / 6.0) * (k_1[6 * i + j] + (2.0 * k_2[6 * i + j]) + (2.0 * k_3[6 * i + j]) + k_4[6 * i + j]);
			y_n[6 * i + j] = y_1[6 * i + j] + avg;
		}
	}

	// Set new position, velocity, and history
	for (int i = 0; i < SIZE; i++) {
		// New position
		bodies[i].x = y_n[6 * i + 0];
		bodies[i].y = y_n[6 * i + 1];
		bodies[i].z = y_n[6 * i + 2];

		// New velocity
		bodies[i].vx = y_n[6 * i + 3];
		bodies[i].vy = y_n[6 * i + 4];
		bodies[i].vz = y_n[6 * i + 5];
	}
}
```

---

## Author 

Made by Dragos Bajanica