//#include <stdlib.h>
//#include <string.h>
#include <stdio.h>
#include <math.h>

// Required constants
#define G		+6.6743E-11				// Gravitational constant
#define DIST	+1.496E+11				// Conversion factor from AU to m
#define TIME	86400.0					// Conversion factor from s to d
#define ACC		(TIME * TIME) / DIST	// Conversion factor from m/s^2 to AU/d^2

// Body struct and bodies
typedef struct {
	double mass;		// Mass
	double x, y, z;		// Position
	double vx, vy, vz;	// Velocity
	double ax, ay, az;	// Acceleration
} Body;
Body bodies[9];			// Array of all main 9 bodies in Solar System

// Required simulation variables
//long unsigned int total;	// Total number of steps to simulate
//long unsigned int time;	// Amount of time to simulate (d)
#define SIZE 9				// Number of bodies (Temporarily set to 9)

// Function prototypes
void euler(double step);
void verlet(double step);
void rk4(double step);

/* Functions used in JavaScript code */

void init_body(int body, double mass, double x, double y, double z, double vx, double vy, double vz) {
	// Set mass
	bodies[body].mass = mass;

	// Set position vector
	bodies[body].x = x;
	bodies[body].y = y;
	bodies[body].z = z;

	// Set velocity vector
	bodies[body].vx = vx;
	bodies[body].vy = vy;
	bodies[body].vz = vz;
}

void simulate_step(int method, double step) {
	switch (method) {
		case 0: // Euler
			euler(step);
			break;
		case 1: // Verlet
			verlet(step);
			break;
		/*
		case 2: // RK4
			rk4(step);
			break;
		*/
		default:
			printf("Unknown method %d!\n", method);
			break;
	}
}

double get_x(int body) {
	return bodies[body].x;
}

double get_y(int body) {
	return bodies[body].y;
}

double get_z(int body) {
	return bodies[body].z;
}

/* Helper functions */

void set_acc(void) {
	for (int i = 0; i < SIZE; i++) {
		bodies[i].ax = 0.0;
		bodies[i].ay = 0.0;
		bodies[i].az = 0.0;
	}

	for (int i = 0; i < SIZE - 1; i++) {
		for (int j = i + 1; j < SIZE; j++) {
			// Compute vector
			double dx, dy, dz;
			dx = DIST * (bodies[j].x - bodies[i].x);
			dy = DIST * (bodies[j].y - bodies[i].y);
			dz = DIST * (bodies[j].z - bodies[i].z);

			// Square root of vector
			double r = sqrt((dx * dx) + (dy * dy) + (dz * dz));

			// Compute acceleration and assign to each body
			double mag = (ACC * G) / (r * r * r);
			double m1 = bodies[j].mass;
			double m2 = bodies[i].mass * -1.0;

			// Compute acceleration vector of first body
			bodies[i].ax += mag * m1 * dx;
			bodies[i].ay += mag * m1 * dy;
			bodies[i].az += mag * m1 * dz;

			// Compute acceleration vector of second body
			bodies[j].ax += mag * m2 * dx;
			bodies[j].ay += mag * m2 * dy;
			bodies[j].az += mag * m2 * dz;
		}
	}
}

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